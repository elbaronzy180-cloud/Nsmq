#!/usr/bin/env bash
# Blaise workspace setup: the browser, video and image tools the screenshot and design checks need.
set +e
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y --no-install-recommends ffmpeg imagemagick poppler-utils fonts-dejavu fonts-liberation fonts-inter fonts-roboto fonts-open-sans fonts-lato fonts-noto-core socat
sudo apt-get install -y --no-install-recommends python3-pip
python3 -m pip install --user --break-system-packages pillow numpy playwright 2>/dev/null || python3 -m pip install --user pillow numpy playwright
python3 -m playwright install --with-deps chromium
fc-cache -f
exit 0
