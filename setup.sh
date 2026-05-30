#!/usr/bin/env bash
set -e

# ResuForge Hunter - Setup Script

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()    { echo -e "${GREEN}[+]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
die()     { echo -e "${RED}[x]${NC} $1"; exit 1; }

# ── 1. Ollama ─────────────────────────────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
    warn "Ollama not found. Installing..."
    curl -fsSL https://ollama.com/install.sh | sh
    info "Ollama installed."
else
    info "Ollama already installed: $(ollama --version 2>/dev/null || echo 'version unknown')"
fi

# Ensure Ollama daemon is running
if ! pgrep -x ollama &>/dev/null; then
    info "Starting Ollama daemon in background..."
    ollama serve &>/dev/null &
    sleep 3
fi

# ── 2. Pull models ────────────────────────────────────────────────────────────
info "Pulling llama3.2 (this may take a few minutes)..."
ollama pull llama3.2

info "Pulling nomic-embed-text..."
ollama pull nomic-embed-text

# ── 3. Working directory ──────────────────────────────────────────────────────
DEST="$HOME/ResuForge-Hunter"
if [ ! -d "$DEST" ]; then
    mkdir -p "$DEST"
    info "Created $DEST"
else
    info "Directory already exists: $DEST"
fi

# Copy hunter.py to working directory if not already there
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$DEST/hunter.py" ]; then
    cp "$SCRIPT_DIR/hunter.py" "$DEST/hunter.py"
    info "Copied hunter.py to $DEST"
fi

# ── 4. Python dependencies ────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    die "python3 not found. Install Python 3.9+ and re-run."
fi

PYTHON=$(command -v python3)
info "Using Python: $($PYTHON --version)"

# Create a venv inside the working directory
VENV="$DEST/.venv"
if [ ! -d "$VENV" ]; then
    info "Creating virtual environment at $VENV..."
    $PYTHON -m venv "$VENV"
fi

info "Installing Python dependencies..."
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"

# ── 5. Wrapper script ─────────────────────────────────────────────────────────
WRAPPER="$DEST/hunt"
cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
cd "$DEST"
"$VENV/bin/python" hunter.py "\$@"
EOF
chmod +x "$WRAPPER"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ResuForge Hunter is ready.${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""
echo "  Working directory : $DEST"
echo "  Quick launcher    : $DEST/hunt"
echo ""
echo "  Next steps:"
echo "    cd $DEST"
echo "    ./hunt setup          # build your master profile"
echo "    ./hunt real_hunt      # find live job listings"
echo "    ./hunt forge \"SOC Analyst\"   # generate tailored application"
echo ""
