#!/usr/bin/python3

import os
import os.path


def set_svg_color(svg_contents: str, color_code: str) -> str:
    if color_code[0] != "#":
        color_code = f"#{color_code}"
    after_first_close_tag = svg_contents.find(">") + 1
    last_open_tag = svg_contents.rfind("<")
    return f"""{svg_contents[:after_first_close_tag]}
<g fill=\"{color_code}\">
{svg_contents[after_first_close_tag:last_open_tag]}
</g></svg>"""


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Change the color of a svg to a new value"
    )
    parser.add_argument(
        "--new-color",
        "-c",
        type=str,
        nargs=1,
        default=["#ffffff"],
        help="hex code for the new color",
    )
    parser.add_argument(
        "--dest-folder",
        "-d",
        type=str,
        nargs=1,
        default=[os.getcwd()],
        help="destination folder for the resulting svgs",
    )
    parser.add_argument("svgs", type=str, nargs="+", help="path to the svgs")

    args = parser.parse_args()

    for svg in args.svgs:
        with open(svg, "r") as svg_file:
            new_svg = set_svg_color(svg_file.read(-1), args.new_color[0])
        with open(
            os.path.join(args.dest_folder[0], os.path.basename(svg)), "w"
        ) as new_svg_file:
            new_svg_file.write(new_svg)
