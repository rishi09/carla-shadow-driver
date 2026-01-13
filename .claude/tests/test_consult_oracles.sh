#!/bin/bash
# Test script for consult-oracles.sh
# Run locally to verify the oracle consultation script works correctly
#
# NOTE: This test uses the actual oracle CLIs (claude, codex, gemini).
# Tests will be skipped if the CLIs are not available.
# shellcheck disable=SC2317

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
ORACLE_SCRIPT="$PLUGIN_ROOT/scripts/consult-oracles.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

# Create temp directory for tests
TEST_TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_TEMP_DIR"' EXIT

# Check which oracles are available
check_oracle_availability() {
    CLAUDE_AVAILABLE=false
    CODEX_AVAILABLE=false
    GEMINI_AVAILABLE=false

    if command -v claude &>/dev/null; then
        CLAUDE_AVAILABLE=true
    fi

    if command -v codex &>/dev/null; then
        CODEX_AVAILABLE=true
    fi

    if command -v gemini &>/dev/null; then
        GEMINI_AVAILABLE=true
    fi

    echo ""
    echo "Oracle availability:"
    if $CLAUDE_AVAILABLE; then
        echo -e "  ${GREEN}✓ claude${NC}"
    else
        echo -e "  ${YELLOW}✗ claude (not found)${NC}"
    fi

    if $CODEX_AVAILABLE; then
        echo -e "  ${GREEN}✓ codex${NC}"
    else
        echo -e "  ${YELLOW}✗ codex (not found)${NC}"
    fi

    if $GEMINI_AVAILABLE; then
        echo -e "  ${GREEN}✓ gemini${NC}"
    else
        echo -e "  ${YELLOW}✗ gemini (not found)${NC}"
    fi

    # Need at least one oracle for basic tests
    if ! $CLAUDE_AVAILABLE && ! $CODEX_AVAILABLE && ! $GEMINI_AVAILABLE; then
        echo ""
        echo -e "${YELLOW}WARNING: No oracle CLIs found. Most tests will be skipped.${NC}"
        echo "Install at least one oracle CLI to run integration tests:"
        echo "  - claude: claude-code CLI"
        echo "  - codex: codex CLI"
        echo "  - gemini: gemini CLI"
    fi
}

run_test() {
    local name="$1"
    local test_fn="$2"
    local requires_oracle="$3"  # Optional: skip if no oracles available

    echo ""
    echo -e "${BLUE}Running: $name${NC}"

    ((TESTS_RUN++))

    # Skip if test requires oracles and none are available
    if [[ "$requires_oracle" == "true" ]] && ! $CLAUDE_AVAILABLE && ! $CODEX_AVAILABLE && ! $GEMINI_AVAILABLE; then
        echo -e "${YELLOW}⊘ SKIPPED (no oracle CLIs available)${NC}"
        ((TESTS_SKIPPED++))
        return 0
    fi

    if $test_fn; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}"
        ((TESTS_FAILED++))
    fi
}

# Test 1: Basic scroll generation
test_basic_scroll_generation() {
    local output_dir="$TEST_TEMP_DIR/scrolls"
    export ORACLE_OUTPUT_DIR="$output_dir"

    "$ORACLE_SCRIPT" "What is the best approach for testing?" > /dev/null 2>&1

    # Check that a scroll was created
    local scroll_count
    scroll_count=$(find "$output_dir" -name "oracle_wisdom_*.md" 2>/dev/null | wc -l)
    if [[ $scroll_count -eq 1 ]]; then
        return 0
    else
        echo "Expected 1 scroll, found $scroll_count"
        return 1
    fi
}

# Test 2: Scroll contains expected structure
test_scroll_structure() {
    local output_dir="$TEST_TEMP_DIR/scrolls2"
    export ORACLE_OUTPUT_DIR="$output_dir"

    "$ORACLE_SCRIPT" "How should I structure this code?" > /dev/null 2>&1

    local scroll
    scroll=$(find "$output_dir" -name "oracle_wisdom_*.md" | head -1)

    if [[ ! -f "$scroll" ]]; then
        echo "No scroll file created"
        return 1
    fi

    # Check for required sections
    if ! grep -q "# Scroll of the Three Oracles" "$scroll"; then
        echo "Missing scroll title"
        return 1
    fi

    if ! grep -q "## The Inquiry" "$scroll"; then
        echo "Missing inquiry section"
        return 1
    fi

    if ! grep -q "## For the Seeker" "$scroll"; then
        echo "Missing seeker section"
        return 1
    fi

    return 0
}

# Test 3: Allows questions with special characters (backticks, parens, etc.)
test_input_validation_allows_parens() {
    local output_dir="$TEST_TEMP_DIR/scrolls3"
    export ORACLE_OUTPUT_DIR="$output_dir"

    # Should allow questions with markdown code, parentheses, dollar signs, etc.
    if "$ORACLE_SCRIPT" "What about costs (in dollars) and code like \`foo\$(bar)\`?" > /dev/null 2>&1; then
        # Check scroll was created
        local scroll_count
        scroll_count=$(find "$output_dir" -name "oracle_wisdom_*.md" 2>/dev/null | wc -l)
        if [[ $scroll_count -eq 1 ]]; then
            return 0
        else
            echo "Scroll not created for input with special characters"
            return 1
        fi
    else
        echo "Rejected valid input with special characters"
        return 1
    fi
}

# Test 4: Scroll path is returned
test_scroll_path_output() {
    local output_dir="$TEST_TEMP_DIR/scrolls4"
    export ORACLE_OUTPUT_DIR="$output_dir"

    local output
    output=$("$ORACLE_SCRIPT" "Test question" 2>&1)

    # Should output "Scroll Location:" with a path
    if echo "$output" | grep -q "Scroll Location:"; then
        return 0
    else
        echo "Missing scroll location in output"
        return 1
    fi
}

# Test 5: XDG_DATA_HOME directory creation
test_xdg_directory() {
    local xdg_home="$TEST_TEMP_DIR/xdg"
    export XDG_DATA_HOME="$xdg_home"
    unset ORACLE_OUTPUT_DIR  # Use default which should use XDG_DATA_HOME

    "$ORACLE_SCRIPT" "Test XDG" > /dev/null 2>&1

    local expected_dir="$xdg_home/claude/plugins/consult-the-oracles/scrolls"

    if [[ -d "$expected_dir" ]]; then
        local scroll_count
        scroll_count=$(find "$expected_dir" -name "oracle_wisdom_*.md" 2>/dev/null | wc -l)
        if [[ $scroll_count -eq 1 ]]; then
            return 0
        else
            echo "Scroll not created in XDG directory"
            return 1
        fi
    else
        echo "XDG directory not created: $expected_dir"
        return 1
    fi
}

# Main test execution
echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║      consult-oracles.sh Test Suite                   ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════╝${NC}"

# Check oracle availability
check_oracle_availability

# Run tests
# Integration tests require at least one oracle CLI
run_test "Basic scroll generation" test_basic_scroll_generation true
run_test "Scroll structure" test_scroll_structure true
run_test "Scroll path output" test_scroll_path_output true
run_test "XDG directory creation" test_xdg_directory true
run_test "Allows questions with special characters" test_input_validation_allows_parens true

# Summary
echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║                    Final Summary                     ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Tests run:     $TESTS_RUN"
echo -e "Tests passed:  ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed:  ${RED}$TESTS_FAILED${NC}"
echo -e "Tests skipped: ${YELLOW}$TESTS_SKIPPED${NC}"
echo ""

if [[ $TESTS_FAILED -gt 0 ]]; then
    echo -e "${RED}SOME TESTS FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}ALL TESTS PASSED${NC}"
    if [[ $TESTS_SKIPPED -gt 0 ]]; then
        echo -e "${YELLOW}(Some tests were skipped - install oracle CLIs for full coverage)${NC}"
    fi
    exit 0
fi
