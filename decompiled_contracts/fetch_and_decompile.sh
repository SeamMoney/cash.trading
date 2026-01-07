#!/bin/bash

CONTRACT_ADDR="0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75"
REVELA_BIN="/Users/maxmohammadi/revela/target/release/revela"
BYTECODE_DIR="bytecode"
SOURCE_DIR="source"

# Fetch all modules
echo "Fetching modules from Aptos testnet..."
MODULES_JSON=$(curl -s "https://api.testnet.aptoslabs.com/v1/accounts/${CONTRACT_ADDR}/modules")

# Get list of module names
MODULE_NAMES=$(echo "$MODULES_JSON" | jq -r '.[].abi.name')

echo "Found $(echo "$MODULE_NAMES" | wc -l | tr -d ' ') modules"

# Process each module
for MODULE_NAME in $MODULE_NAMES; do
    echo "Processing: $MODULE_NAME"

    # Extract bytecode for this module (remove 0x prefix)
    BYTECODE=$(echo "$MODULES_JSON" | jq -r --arg name "$MODULE_NAME" '.[] | select(.abi.name == $name) | .bytecode' | sed 's/^0x//')

    # Save bytecode as binary file
    echo "$BYTECODE" | xxd -r -p > "${BYTECODE_DIR}/${MODULE_NAME}.mv"

    # Decompile
    if [ -f "${BYTECODE_DIR}/${MODULE_NAME}.mv" ] && [ -s "${BYTECODE_DIR}/${MODULE_NAME}.mv" ]; then
        $REVELA_BIN --bytecode "${BYTECODE_DIR}/${MODULE_NAME}.mv" > "${SOURCE_DIR}/${MODULE_NAME}.move" 2>&1
        if [ $? -eq 0 ]; then
            echo "  ✓ Decompiled successfully"
        else
            echo "  ✗ Decompilation failed"
        fi
    else
        echo "  ✗ Failed to save bytecode"
    fi
done

echo ""
echo "Done! Decompiled sources are in: ${SOURCE_DIR}/"
