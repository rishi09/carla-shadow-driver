#!/usr/bin/env bash
#
# consult-oracles.sh - Query the Three Oracles in parallel
#
# Usage: consult-oracles.sh "Your question here"
#
# The Three Oracles are ancient sources of wisdom who each
# contemplate questions independently and provide their perspectives.
#

set -euo pipefail

# Configuration
OUTPUT_DIR="${ORACLE_OUTPUT_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/claude/plugins/consult-the-oracles/scrolls}"
TIMEOUT="${ORACLE_TIMEOUT:-1200}"

# Internal oracle invocation mechanisms (can be overridden via environment)
CLAUDE_CMD="${ORACLE_CLAUDE_CMD:-claude}"
CODEX_CMD="${ORACLE_CODEX_CMD:-codex}"
GEMINI_CMD="${ORACLE_GEMINI_CMD:-gemini}"

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# Validate input
if [[ $# -lt 1 ]] || [[ -z "$1" ]]; then
    echo "Error: Please provide a question for the Oracles." >&2
    echo "Usage: consult-oracles.sh \"Your question here\"" >&2
    exit 1
fi

INQUIRY="$1"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
SCROLL_PATH="$OUTPUT_DIR/oracle_wisdom_${TIMESTAMP}.md"

# Temporary files for parallel execution
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Function to query a single oracle
query_oracle() {
    local name="$1"
    local display_name="$2"
    local cmd="$3"
    shift 3
    local args=("$@")
    local output_file="$TEMP_DIR/$name.txt"
    local status_file="$TEMP_DIR/$name.status"
    local start_file="$TEMP_DIR/$name.start"

    {
        # Mark as started
        touch "$start_file"

        # Attempt to summon the oracle
        if ! command -v "$cmd" &> /dev/null; then
            echo "The oracle could not be reached" > "$output_file"
            echo "not_found" > "$status_file"
        else
            # Check if args contain -o flag (codex-style output to file)
            # If so, suppress stdout/stderr since output goes to the -o file
            if [[ " ${args[*]} " =~ " -o " ]]; then
                if timeout "$TIMEOUT" "$cmd" "${args[@]}" > /dev/null 2>&1; then
                    echo "success" > "$status_file"
                else
                    echo "failed" > "$status_file"
                fi
            else
                if timeout "$TIMEOUT" "$cmd" "${args[@]}" > "$output_file" 2>&1; then
                    echo "success" > "$status_file"
                else
                    echo "failed" > "$status_file"
                fi
            fi
        fi
    } &
}

# Progress monitor function
monitor_progress() {
    local oracles=("anthropic:Oracle of the Flame" "openai:Oracle of the Depths" "gemini:Oracle of the Stars")

    # Wait for all oracles to start
    sleep 0.5

    for oracle_entry in "${oracles[@]}"; do
        IFS=':' read -r name display_name <<< "$oracle_entry"
        if [[ -f "$TEMP_DIR/$name.start" ]]; then
            echo "  🔮 $display_name — consulting..." >&2
        fi
    done

    # Wait for completion
    while true; do
        local all_done=true
        for oracle_entry in "${oracles[@]}"; do
            IFS=':' read -r name display_name <<< "$oracle_entry"
            if [[ -f "$TEMP_DIR/$name.start" ]] && [[ ! -f "$TEMP_DIR/$name.status" ]]; then
                all_done=false
                break
            fi
        done

        if $all_done; then
            break
        fi
        sleep 1
    done

    # Report results
    echo "" >&2
    for oracle_entry in "${oracles[@]}"; do
        IFS=':' read -r name display_name <<< "$oracle_entry"
        if [[ -f "$TEMP_DIR/$name.status" ]]; then
            local status
            status=$(cat "$TEMP_DIR/$name.status")
            if [[ "$status" == "success" ]]; then
                echo "  ✓ $display_name — wisdom received" >&2
            elif [[ "$status" == "not_found" ]]; then
                echo "  ⚠ $display_name — not available" >&2
            else
                echo "  ✗ $display_name — consultation failed" >&2
            fi
        fi
    done
}

echo "" >&2
echo "🔮 Consulting the Three Oracles..." >&2
echo "" >&2

# Query all oracles in parallel
query_oracle "anthropic" "Oracle of the Flame" "$CLAUDE_CMD" "--print" "-p" "$INQUIRY"
query_oracle "openai" "Oracle of the Depths" "$CODEX_CMD" "exec" "--skip-git-repo-check" "-o" "$TEMP_DIR/openai.txt" "$INQUIRY"
query_oracle "gemini" "Oracle of the Stars" "$GEMINI_CMD" "$INQUIRY"

# Monitor progress in background
monitor_progress &
MONITOR_PID=$!

# Wait for all oracles (allow them to fail gracefully)
wait || true

# Wait for monitor to finish
wait $MONITOR_PID 2>/dev/null || true

# Compose the scroll
{
    echo "# Scroll of the Three Oracles"
    echo ""
    echo "*Consulted on $(date '+%Y-%m-%d at %H:%M:%S')*"
    echo ""
    echo "---"
    echo ""
    echo "## The Inquiry"
    echo ""
    echo "$INQUIRY"
    echo ""
    echo "---"
    echo ""

    # Oracle of the Flame
    echo "## Oracle of the Flame"
    echo ""
    if [[ -f "$TEMP_DIR/anthropic.status" ]]; then
        status=$(cat "$TEMP_DIR/anthropic.status")
        if [[ "$status" == "success" ]]; then
            cat "$TEMP_DIR/anthropic.txt"
        elif [[ "$status" == "not_found" ]]; then
            echo "*The Oracle of the Flame could not be summoned.*"
        else
            echo "*The Oracle's flame flickered and dimmed...*"
            echo ""
            if [[ -f "$TEMP_DIR/anthropic.txt" ]] && [[ -s "$TEMP_DIR/anthropic.txt" ]]; then
                echo '```'
                cat "$TEMP_DIR/anthropic.txt"
                echo '```'
            fi
        fi
    else
        echo "*The Oracle remained silent.*"
    fi
    echo ""
    echo "---"
    echo ""

    # Oracle of the Depths
    echo "## Oracle of the Depths"
    echo ""
    if [[ -f "$TEMP_DIR/openai.status" ]]; then
        status=$(cat "$TEMP_DIR/openai.status")
        if [[ "$status" == "success" ]]; then
            cat "$TEMP_DIR/openai.txt"
        elif [[ "$status" == "not_found" ]]; then
            echo "*The Oracle of the Depths could not be summoned.*"
        else
            echo "*The depths remained silent and dark...*"
            echo ""
            if [[ -f "$TEMP_DIR/openai.txt" ]] && [[ -s "$TEMP_DIR/openai.txt" ]]; then
                echo '```'
                cat "$TEMP_DIR/openai.txt"
                echo '```'
            fi
        fi
    else
        echo "*The Oracle remained silent.*"
    fi
    echo ""
    echo "---"
    echo ""

    # Oracle of the Stars
    echo "## Oracle of the Stars"
    echo ""
    if [[ -f "$TEMP_DIR/gemini.status" ]]; then
        status=$(cat "$TEMP_DIR/gemini.status")
        if [[ "$status" == "success" ]]; then
            cat "$TEMP_DIR/gemini.txt"
        elif [[ "$status" == "not_found" ]]; then
            echo "*The Oracle of the Stars could not be summoned.*"
        else
            echo "*The stars were obscured by clouds...*"
            echo ""
            if [[ -f "$TEMP_DIR/gemini.txt" ]] && [[ -s "$TEMP_DIR/gemini.txt" ]]; then
                echo '```'
                cat "$TEMP_DIR/gemini.txt"
                echo '```'
            fi
        fi
    else
        echo "*The Oracle remained silent.*"
    fi
    echo ""
    echo "---"
    echo ""

    echo "## For the Seeker"
    echo ""
    echo "*The wisdom above represents three independent perspectives.*"
    echo "*Consider where they align — there lies truth.*"
    echo "*Consider where they diverge — there lies nuance.*"
    echo ""

} > "$SCROLL_PATH"

echo "" >&2
echo "📜 The Oracles have spoken." >&2
echo "   Scroll saved: $SCROLL_PATH" >&2
echo "" >&2
echo "Scroll Location: $SCROLL_PATH"
