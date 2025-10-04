#!/bin/bash
# Build script for P2P Live Share WebSocket Server (Go)

set -e

echo "Building P2P Live Share WebSocket Server (Go)..."

cd "$(dirname "$0")"

# Download dependencies
echo "Downloading dependencies..."
go mod download

# Build with optimizations for minimal binary size and static linking
echo "Building binary with static linking..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ws-server

echo "Build complete! Binary: ./ws-server"

zip serverless.zip ws-server scf_bootstrap
echo "Zipped binary: ./serverless.zip"
