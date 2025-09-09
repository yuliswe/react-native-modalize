#!/bin/bash

# Script to read version number from package.json and output to stdout

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_JSON="$SCRIPT_DIR/../package.json"

# Check if package.json exists
if [ ! -f "$PACKAGE_JSON" ]; then
    echo "Error: package.json not found at $PACKAGE_JSON" >&2
    exit 1
fi

# Extract version from package.json and output to stdout
node -p "require('$PACKAGE_JSON').version"
