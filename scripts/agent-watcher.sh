#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# IMECE AGENT WATCHER - Per-Agent Background Monitor
# ═══════════════════════════════════════════════════════════════════════════════
#
# This script monitors a specific agent's inbox and automatically:
# 1. Sends heartbeats to keep the agent "alive"
# 2. Detects new messages and triggers action
# 3. Auto-claims tasks assigned to the agent
# 4. Updates agent status based on activity
#
# Usage:
#   ./agent-watcher.sh <agent-name> [--interval <ms>]
#
# Example (run in background):
#   nohup ./agent-watcher.sh glm --interval 3000 > /dev/null 2>&1 &
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

AGENT_NAME="${1:-}"
INTERVAL="${2:-5000}"
INTERVAL=$((INTERVAL / 1000))  # Convert to seconds

IMECE_DIR=".imece"
TRIGGER_DIR="$IMECE_DIR/triggers"
PID_FILE="$IMECE_DIR/.watcher.$AGENT_NAME.pid"
LOG_FILE="$IMECE_DIR/.watcher.$AGENT_NAME.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION
# ─────────────────────────────────────────────────────────────────────────────

if [[ -z "$AGENT_NAME" ]]; then
    echo -e "${RED}Error: Agent name required${NC}"
    echo "Usage: $0 <agent-name> [--interval <ms>]"
    exit 1
fi

if [[ ! -d "$IMECE_DIR" ]]; then
    echo -e "${RED}Error: imece not initialized${NC}"
    exit 1
fi

# Check if agent exists
if ! imece whoami "$AGENT_NAME" > /dev/null 2>&1; then
    echo -e "${RED}Error: Agent '$AGENT_NAME' not registered${NC}"
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

log() {
    local timestamp=$(date '+%H:%M:%S')
    echo "[$timestamp] $*" >> "$LOG_FILE"
    echo -e "${CYAN}[$timestamp]${NC} $*"
}

get_inbox_count() {
    imece inbox "$AGENT_NAME" 2>/dev/null | grep -c "unread" || echo "0"
}

get_pending_tasks() {
    imece task list --agent "$AGENT_NAME" --status pending 2>/dev/null | wc -l || echo "0"
}

process_inbox() {
    local messages=$(imece inbox "$AGENT_NAME" 2>/dev/null)

    if echo "$messages" | grep -q "unread"; then
        log "📬 New messages detected!"

        # Get the first unread message
        local msg_id=$(echo "$messages" | grep "unread" | head -1 | grep -oE '#[a-z0-9]+' | tr -d '#')

        if [[ -n "$msg_id" ]]; then
            log "Processing message: $msg_id"
            # Mark as read
            imece read "$AGENT_NAME" "$msg_id" > /dev/null 2>&1

            # Broadcast that we're processing
            imece broadcast "$AGENT_NAME" "📩 Received new message(s), processing..." > /dev/null 2>&1
        fi
    fi
}

process_tasks() {
    local pending=$(get_pending_tasks)

    if [[ "$pending" -gt 0 ]]; then
        log "📋 $pending pending task(s)"

        # Get first pending task
        local task_info=$(imece task list --agent "$AGENT_NAME" --status pending 2>/dev/null | head -1)
        local task_id=$(echo "$task_info" | grep -oE '#[a-z0-9]+' | head -1 | tr -d '#')

        if [[ -n "$task_id" ]]; then
            log "Attempting to claim task: $task_id"

            # Try to claim
            if imece task claim "$task_id" "$AGENT_NAME" > /dev/null 2>&1; then
                log "✅ Claimed task: $task_id"
                imece broadcast "$AGENT_NAME" "✅ Claimed task: $task_id" > /dev/null 2>&1
            fi
        fi
    fi
}

check_triggers() {
    local trigger_file="$TRIGGER_DIR/$AGENT_NAME.trigger"

    if [[ -f "$trigger_file" ]]; then
        local reason=$(cat "$trigger_file" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4)
        log "🔔 Triggered: $reason"
        rm -f "$trigger_file"

        # Process based on trigger reason
        case "$reason" in
            new-message)
                process_inbox
                ;;
            new-task)
                process_tasks
                ;;
            *)
                process_inbox
                process_tasks
                ;;
        esac
    fi
}

send_heartbeat() {
    imece heartbeat "$AGENT_NAME" > /dev/null 2>&1
}

cleanup() {
    log "🛑 Stopping watcher for $AGENT_NAME"
    rm -f "$PID_FILE"
    imece offline "$AGENT_NAME" > /dev/null 2>&1 || true
    exit 0
}

# ─────────────────────────────────────────────────────────────────────────────
# MAIN LOOP
# ─────────────────────────────────────────────────────────────────────────────

# Save PID
echo $$ > "$PID_FILE"

# Set up signal handlers
trap cleanup SIGINT SIGTERM

log "🚀 Starting watcher for $AGENT_NAME (interval: ${INTERVAL}s)"

# Initial registration
imece heartbeat "$AGENT_NAME" > /dev/null 2>&1
imece broadcast "$AGENT_NAME" "🔄 $AGENT_NAME watcher started - monitoring inbox every ${INTERVAL}s" > /dev/null 2>&1

# Track state
last_inbox_count=$(get_inbox_count)
last_task_count=$(get_pending_tasks)

while true; do
    # Send heartbeat
    send_heartbeat

    # Check for triggers
    check_triggers

    # Check inbox for new messages
    current_inbox=$(get_inbox_count)
    if [[ "$current_inbox" -gt "$last_inbox_count" ]]; then
        log "📬 New message! ($last_inbox_count → $current_inbox)"
        process_inbox
    fi
    last_inbox_count=$current_inbox

    # Check for new pending tasks
    current_tasks=$(get_pending_tasks)
    if [[ "$current_tasks" -gt "$last_task_count" ]]; then
        log "📋 New task! ($last_task_count → $current_tasks)"
        process_tasks
    fi
    last_task_count=$current_tasks

    sleep "$INTERVAL"
done