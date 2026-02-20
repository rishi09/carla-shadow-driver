/**
 * useTwitchChat.ts - Twitch Chat Integration for "Twitch Plays Shadow Driver"
 *
 * Connects to a Twitch channel's IRC chat via anonymous WebSocket and
 * collects control votes in 500ms windows. The winning command each tick
 * drives the car.
 *
 * Twitch IRC (anonymous read-only):
 *   WebSocket: wss://irc-ws.chat.twitch.tv:443
 *   PASS oauth:justinfan12345
 *   NICK justinfan12345
 *   JOIN #channelname
 *
 * Valid commands (case-insensitive):
 *   left, right, gas/go/forward, brake/stop/back, boost/nitro, drift/handbrake
 *
 * Each chatter gets ONE vote per window. Ties keep previous command.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const TWITCH_IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';
const VOTE_WINDOW_MS = 500;
const MIN_RECONNECT_INTERVAL_MS = 5000;
const MAX_CHAT_LOG = 20;

/** Canonical command names */
export type TwitchCommand = 'left' | 'right' | 'gas' | 'brake' | 'boost' | 'drift';

/** All recognized aliases mapped to canonical command */
const COMMAND_ALIASES: Record<string, TwitchCommand> = {
  left: 'left',
  right: 'right',
  gas: 'gas',
  go: 'gas',
  forward: 'gas',
  brake: 'brake',
  stop: 'brake',
  back: 'brake',
  boost: 'boost',
  nitro: 'boost',
  drift: 'drift',
  handbrake: 'drift',
};

export interface TwitchChatMessage {
  user: string;
  msg: string;
  timestamp: number;
}

export interface TwitchChatState {
  /** Whether the WebSocket is connected to Twitch IRC */
  isConnected: boolean;
  /** Unique chatters who voted in the current window */
  viewerCount: number;
  /** The winning command this tick */
  currentCommand: TwitchCommand | '';
  /** Current vote tallies per command */
  votes: Record<TwitchCommand, number>;
  /** Connect to a Twitch channel */
  connect: (channel: string) => void;
  /** Disconnect from Twitch IRC */
  disconnect: () => void;
  /** Last N chat messages (commands only) */
  chatLog: TwitchChatMessage[];
  /** The channel currently connected to (or null) */
  channel: string | null;
}

function emptyVotes(): Record<TwitchCommand, number> {
  return { left: 0, right: 0, gas: 0, brake: 0, boost: 0, drift: 0 };
}

export function useTwitchChat(channel: string | null): TwitchChatState {
  const [isConnected, setIsConnected] = useState(false);
  const [currentCommand, setCurrentCommand] = useState<TwitchCommand | ''>('');
  const [votes, setVotes] = useState<Record<TwitchCommand, number>>(emptyVotes);
  const [viewerCount, setViewerCount] = useState(0);
  const [chatLog, setChatLog] = useState<TwitchChatMessage[]>([]);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const voteWindowRef = useRef<Map<string, TwitchCommand>>(new Map());
  const voteIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastConnectAttemptRef = useRef(0);
  const prevCommandRef = useRef<TwitchCommand | ''>('');

  // Tally votes and elect winner
  const tallyVotes = useCallback(() => {
    const tallies = emptyVotes();
    const voters = voteWindowRef.current;

    for (const cmd of voters.values()) {
      tallies[cmd]++;
    }

    setVotes({ ...tallies });
    setViewerCount(voters.size);

    // Find winner (highest tally); ties keep previous command
    let maxCount = 0;
    let winner: TwitchCommand | '' = '';
    let tieCount = 0;

    for (const [cmd, count] of Object.entries(tallies) as Array<[TwitchCommand, number]>) {
      if (count > maxCount) {
        maxCount = count;
        winner = cmd;
        tieCount = 1;
      } else if (count === maxCount && count > 0) {
        tieCount++;
      }
    }

    // If tie, maintain previous command
    if (tieCount > 1) {
      winner = prevCommandRef.current;
    }

    if (maxCount === 0) {
      winner = '';
    }

    prevCommandRef.current = winner;
    setCurrentCommand(winner);

    // Clear votes for next window
    voteWindowRef.current = new Map();
  }, []);

  const connectToChannel = useCallback((ch: string) => {
    // Rate limit reconnection
    const now = Date.now();
    if (now - lastConnectAttemptRef.current < MIN_RECONNECT_INTERVAL_MS) {
      console.log('[TwitchChat] Reconnect rate limited, waiting...');
      return;
    }
    lastConnectAttemptRef.current = now;

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (voteIntervalRef.current) {
      clearInterval(voteIntervalRef.current);
      voteIntervalRef.current = null;
    }

    const channelName = ch.toLowerCase().replace(/^#/, '');
    console.log(`[TwitchChat] Connecting to #${channelName}...`);

    const ws = new WebSocket(TWITCH_IRC_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[TwitchChat] WebSocket connected, authenticating...');
      ws.send('PASS oauth:justinfan12345');
      ws.send('NICK justinfan12345');
      ws.send(`JOIN #${channelName}`);
    };

    ws.onmessage = (event: MessageEvent) => {
      const raw = event.data as string;
      const lines = raw.split('\r\n').filter(Boolean);

      for (const line of lines) {
        // Respond to PING to stay alive
        if (line.startsWith('PING')) {
          ws.send('PONG :tmi.twitch.tv');
          continue;
        }

        // Detect successful join
        if (line.includes('366') || line.includes('JOIN')) {
          setIsConnected(true);
          setActiveChannel(channelName);
          console.log(`[TwitchChat] Joined #${channelName}`);
        }

        // Parse PRIVMSG
        // Format: :username!username@username.tmi.twitch.tv PRIVMSG #channel :message
        const privmsgMatch = line.match(/^:(\w+)!.*PRIVMSG\s+#\w+\s+:(.+)$/);
        if (privmsgMatch) {
          const username = privmsgMatch[1];
          const message = privmsgMatch[2].trim().toLowerCase();

          // Check if message is a valid command
          const command = COMMAND_ALIASES[message];
          if (command) {
            // One vote per user per window
            voteWindowRef.current.set(username, command);

            // Add to chat log
            setChatLog(prev => {
              const updated = [...prev, { user: username, msg: message, timestamp: Date.now() }];
              return updated.slice(-MAX_CHAT_LOG);
            });
          }
        }
      }
    };

    ws.onerror = (err) => {
      console.error('[TwitchChat] WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('[TwitchChat] WebSocket closed');
      setIsConnected(false);
      setActiveChannel(null);
    };

    // Start vote tally interval
    voteIntervalRef.current = setInterval(tallyVotes, VOTE_WINDOW_MS);
  }, [tallyVotes]);

  const disconnectFromChannel = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (voteIntervalRef.current) {
      clearInterval(voteIntervalRef.current);
      voteIntervalRef.current = null;
    }
    setIsConnected(false);
    setActiveChannel(null);
    setCurrentCommand('');
    setVotes(emptyVotes());
    setViewerCount(0);
    setChatLog([]);
    voteWindowRef.current = new Map();
    prevCommandRef.current = '';
  }, []);

  // Auto-connect when channel prop changes
  useEffect(() => {
    if (channel) {
      connectToChannel(channel);
    } else {
      disconnectFromChannel();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (voteIntervalRef.current) {
        clearInterval(voteIntervalRef.current);
        voteIntervalRef.current = null;
      }
    };
  }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isConnected,
    viewerCount,
    currentCommand,
    votes,
    connect: connectToChannel,
    disconnect: disconnectFromChannel,
    chatLog,
    channel: activeChannel,
  };
}

export default useTwitchChat;
