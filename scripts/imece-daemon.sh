#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# IMECE DAEMON - Real-time Agent Coordination System
# ═══════════════════════════════════════════════════════════════════════════════
#
# This script runs as a background daemon to keep all imece agents "alive"
# and automatically trigger them when they receive messages or tasks.
#
# Usage:
#   ./imece-daemon.sh start [--interval <ms>] [--agents <agent1,agent2>]
#   ./imece-daemon.sh stop
#   ./imece-daemon.sh status
#   ./imece-daemon.sh monitor
#
# Environment Variables:
#   IMECE_INTERVAL   - Polling interval in milliseconds (default: 5000)
#   IMECE_AGENTS     - Comma-separated list of agents to monitor
#   IMECE_LOG_LEVEL  - Log level: debug, info, warn, error (default: info)
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Configuration
IMECE_DIR=".imece"
PID_FILE="$IMECE_DIR/.daemon.pid"
LOG_FILE="$IMECE_DIR/.daemon.log"
STATE_FILE="$IMECE_DIR/.daemon.state"
DEFAULT_INTERVAL=5000
DEFAULT_LOG_LEVEL="info"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─────────────────────────────────────────────────────────────────────────────
# UTILITY FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"

    case "$level" in
        ERROR)   echo -e "${RED}[$timestamp] [ERROR] $message${NC}" >&2 ;;
        WARN)    echo -e "${YELLOW}[$timestamp] [WARN] $message${NC}" ;;
        INFO)    echo -e "${GREEN}[$timestamp] [INFO] $message${NC}" ;;
        DEBUG)   [[ "$LOG_LEVEL" == "debug" ]] && echo -e "${CYAN}[$timestamp] [DEBUG] $message${NC}" ;;
    esac
}

check_imece_initialized() {
    if [[ ! -d "$IMECE_DIR" ]]; then
        log ERROR "imece not initialized. Run: imece init"
        exit 1
    fi
}

get_online_agents() {
    imece status 2>/dev/null | grep -E "^\│.*online" | awk -F'│' '{print $2}' | tr -d ' '
}

get_agent_inbox_count() {
    local agent="$1"
    imece inbox "$agent" 2>/dev/null | grep -c "unread" || echo "0"
}

get_agent_tasks() {
    local agent="$1"
    imece task list --agent "$agent" 2>/dev/null | grep -E "pending|active" || true
}

# ─────────────────────────────────────────────────────────────────────────────
# DAEMON FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

start_daemon() {
    local interval="${IMECE_INTERVAL:-$DEFAULT_INTERVAL}"
    interval=$((interval / 1000))  # Convert to seconds

    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        log WARN "Daemon already running with PID $(cat $PID_FILE)"
        exit 0
    fi

    check_imece_initialized

    log INFO "Starting imece daemon..."
    log INFO "Interval: ${interval}s"
    log INFO "Log file: $LOG_FILE"

    # Create state file
    echo '{"status":"running","startedAt":"'"$(date -Iseconds)"'","interval":'"$interval"'}' > "$STATE_FILE"

    # Start background loop
    (
        while true; do
            # Get all online agents
            local agents=$(get_online_agents)

            for agent in $agents; do
                # Check inbox
                local inbox_before=$(get_agent_inbox_count "$agent")

                # Send heartbeat
                imece heartbeat "$agent" > /dev/null 2>&1

                # Check for new messages
                local inbox_after=$(get_agent_inbox_count "$agent")

                if [[ "$inbox_after" -gt "$inbox_before" ]]; then
                    log INFO "New message for $agent! Triggering..."
                    trigger_agent "$agent" "new-message"
                fi

                # Check for pending tasks
                local pending_tasks=$(imece task list --agent "$agent" --status pending 2>/dev/null | wc -l)
                if [[ "$pending_tasks" -gt 0 ]]; then
                    log INFO "Pending tasks for $agent"
                fi
            done

            sleep "$interval"
        done
    ) &

    echo $! > "$PID_FILE"
    log INFO "Daemon started with PID $(cat $PID_FILE)"

    echo -e "${GREEN}✓${NC} imece daemon started"
    echo "  PID: $(cat $PID_FILE)"
    echo "  Interval: ${interval}s"
    echo "  Log: $LOG_FILE"
}

stop_daemon() {
    if [[ ! -f "$PID_FILE" ]]; then
        log WARN "No daemon PID file found"
        exit 0
    fi

    local pid=$(cat "$PID_FILE")

    if kill -0 "$pid" 2>/dev/null; then
        log INFO "Stopping daemon (PID: $pid)..."
        kill "$pid" 2>/dev/null
        rm -f "$PID_FILE"
        echo '{"status":"stopped","stoppedAt":"'"$(date -Iseconds)"'"}' > "$STATE_FILE"
        log INFO "Daemon stopped"
        echo -e "${GREEN}✓${NC} imece daemon stopped"
    else
        log WARN "Daemon process not running (stale PID file)"
        rm -f "$PID_FILE"
    fi
}

daemon_status() {
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo -e "${GREEN}●${NC} imece daemon is ${GREEN}running${NC}"
        echo "  PID: $(cat $PID_FILE)"
        if [[ -f "$STATE_FILE" ]]; then
            echo "  State: $(cat $STATE_FILE)"
        fi
        echo "  Log: $LOG_FILE"
    else
        echo -e "${RED}○${NC} imece daemon is ${RED}stopped${NC}"
        [[ -f "$PID_FILE" ]] && rm -f "$PID_FILE"
    fi
}

monitor_daemon() {
    check_imece_initialized

    echo -e "${CYAN}╭──────────────────────────────────────────────────────╮${NC}"
    echo -e "${CYAN}│${NC} ${BOLD}IMECE DAEMON MONITOR${NC}                                  ${CYAN}│${NC}"
    echo -e "${CYAN}╰──────────────────────────────────────────────────────╯${NC}"
    echo

    while true; do
        clear
        echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
        echo -e " ${BOLD}IMECE DAEMON MONITOR${NC} - $(date '+%H:%M:%S')"
        echo -e "${CYAN}══════════════════════════════════════════════════════${NC}"
        echo

        # Show daemon status
        if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo -e "${GREEN}● Daemon: RUNNING${NC} (PID: $(cat $PID_FILE))"
        else
            echo -e "${RED}○ Daemon: STOPPED${NC}"
        fi
        echo

        # Show agents
        echo -e "${YELLOW}AGENTS:${NC}"
        imece status 2>/dev/null | grep -E "^\│" | head -6
        echo

        # Show recent timeline
        echo -e "${YELLOW}RECENT ACTIVITY:${NC}"
        imece timeline --limit 5 2>/dev/null
        echo

        # Show pending tasks
        echo -e "${YELLOW}PENDING TASKS:${NC}"
        imece task list --status pending 2>/dev/null | head -5

        echo
        echo -e "${CYAN}──────────────────────────────────────────────────────${NC}"
        echo " Press Ctrl+C to exit | Refresh: 5s"

        sleep 5
    done
}

trigger_agent() {
    local agent="$1"
    local reason="$2"

    log INFO "Triggering $agent: $reason"

    # Create trigger file that agent can detect
    local trigger_file="$IMECE_DIR/triggers/$agent.trigger"
    mkdir -p "$IMECE_DIR/triggers"
    echo "{\"agent\":\"$agent\",\"reason\":\"$reason\",\"timestamp\":\"$(date -Iseconds)\"}" > "$trigger_file"

    # Broadcast to swarm
    imece broadcast "$agent" "🔄 $agent triggered: $reason" > /dev/null 2>&1
}

# ─────────────────────────────────────────────────────────────────────────────
# COMMAND ROUTER
# ─────────────────────────────────────────────────────────────────────────────

LOG_LEVEL="${IMECE_LOG_LEVEL:-$DEFAULT_LOG_LEVEL}"

case "${1:-}" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    restart)
        stop_daemon
        sleep 1
        start_daemon
        ;;
    status)
        daemon_status
        ;;
    monitor)
        monitor_daemon
        ;;
    trigger)
        [[ -z "${2:-}" ]] && { echo "Usage: $0 trigger <agent>"; exit 1; }
        trigger_agent "$2" "${3:-manual}"
        ;;
    *)
        echo "imece-daemon - Real-time Agent Coordination System"
        echo
        echo "Usage: $0 <command> [options]"
        echo
        echo "Commands:"
        echo "  start     Start the daemon"
        echo "  stop      Stop the daemon"
        echo "  restart   Restart the daemon"
        echo "  status    Check daemon status"
        echo "  monitor   Real-time monitoring dashboard"
        echo "  trigger   Manually trigger an agent"
        echo
        echo "Environment Variables:"
        echo "  IMECE_INTERVAL   Polling interval in ms (default: 5000)"
        echo "  IMECE_LOG_LEVEL  Log level: debug, info, warn, error"
        echo
        echo "Examples:"
        echo "  $0 start"
        echo "  IMECE_INTERVAL=2000 $0 start"
        echo "  $0 monitor"
        exit 1
        ;;
esac