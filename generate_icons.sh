#!/bin/bash

set -euox pipefail

svgs=("endpoints_disconnected.svg" )
abspath=()

for file in "${svgs[@]}"; do
    path=./node_modules/eos-icons/svg/${file}
    cp ${path} media/light/
    abspath+=$path
done

./scripts/change_svg_color.py -c ffffff -d media/dark/ ${abspath[@]}
