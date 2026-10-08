# cloud-probe/Dockerfile — the one-shot Amex compatibility probe image (plan omf-railway-amex-probe-20261007, S5).
# Railway builds it from the staged upload (cloud-probe/local/drive.mjs stage): this file and railway.json at the
# upload root, the runner under cloud-probe/, the Windows collector's modules under collector/ and shared/.
# Pinned: the base image by digest; Node and Chrome by version and sha256 (the pins the 2026-10-06 pilot verified
# against signed sources). NOT pinned: the Debian packages, which resolve when the image is built.

# debian:bookworm-slim, index digest read from Docker Hub on 2026-10-07.
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587

# Node 24.13.1 (nodejs.org SHASUMS256.txt, signed by a release key the v24.13.1 README lists) and
# Google Chrome stable 155.0.8059.39 (dl.google.com Packages index under Google's signed InRelease).
# xvfb: the display puppeteer-real-browser starts; fonts-noto-cjk: Japanese glyphs; tzdata and
# locales: Asia/Tokyo and ja_JP.UTF-8; procps: the `ps` that tree-kill runs when Chrome closes.
RUN export DEBIAN_FRONTEND=noninteractive \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl xz-utils xvfb fonts-noto-cjk tzdata locales procps tini \
 && sed -i 's/^# *ja_JP.UTF-8 UTF-8/ja_JP.UTF-8 UTF-8/' /etc/locale.gen && locale-gen \
 && ln -snf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && echo Asia/Tokyo > /etc/timezone \
 && curl -fsSLo /tmp/node.tar.xz https://nodejs.org/dist/v24.13.1/node-v24.13.1-linux-x64.tar.xz \
 && echo "30215f90ea3cd04dfbc06e762c021393fa173a1d392974298bbc871a8e461089  /tmp/node.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
 && curl -fsSLo /tmp/chrome.deb https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_155.0.8059.39-1_amd64.deb \
 && echo "c58aa0f2cd66179c9f050e062c882d27aa9b9f8c2b7c73fee3498560b5ed0b38  /tmp/chrome.deb" | sha256sum -c - \
 && apt-get install -y --no-install-recommends /tmp/chrome.deb \
 && apt-get purge -y curl xz-utils && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /tmp/node.tar.xz /tmp/chrome.deb

# A non-root user; /run/omf is a plain writable directory for the Chrome profile, the download and the work folder
# (cloud-probe/run.mjs removes profile, download and work at the end of every run).
RUN useradd --uid 10001 --user-group --no-create-home --home-dir /run/omf/home --shell /usr/sbin/nologin omf \
 && mkdir -p /run/omf/home /run/omf/tmp && chown -R omf:omf /run/omf

WORKDIR /app
# The collector's locked dependencies, without install scripts (the only one builds xvfb's optional native addon,
# which falls back without it). googleapis ships because collector/browser.mjs:10 imports it at load time; the
# container never calls Gmail.
COPY collector/package.json collector/package-lock.json collector/
RUN cd collector && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY collector/*.mjs collector/
COPY shared/amex.mjs shared/
COPY cloud-probe/run.mjs cloud-probe/relay.mjs cloud-probe/idle.mjs cloud-probe/

ENV LANG=ja_JP.UTF-8 TZ=Asia/Tokyo HOME=/run/omf/home TMPDIR=/run/omf/tmp
USER omf
ENTRYPOINT ["/usr/bin/tini", "--", "node", "cloud-probe/idle.mjs"]
