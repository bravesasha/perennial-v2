#!/bin/bash

# Output file path
output_file="code_size.txt"

# Run the command and filter lines that start with '|' or '·', removing color codes
filtered_output=$(yarn workspaces run build | grep -E '^\s*(\||·)' | sed -r 's/\x1B\[[0-9;]*[mK]//g')

# Extract only the core contracts table
core_code_size_table=$(echo "$filtered_output" | awk '
    /·--/ {
        # Capture first table starting and ending with ·--
        if (capturing) {
            print
            exit
        }
        capturing = 1
    }
    capturing {
        print
    }
')

# Format the captured table for GitHub comment with collapsible section
formatted_core_code_size_table="<details><summary>View Report</summary><code>$core_code_size_table</code></details>"

# Write the formatted table to the output file
echo "$formatted_core_code_size_table" > "$output_file"
