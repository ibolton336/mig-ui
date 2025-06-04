FROM registry.access.redhat.com/ubi8/nodejs-16 as builder

USER root

# Set up working directory
COPY . /mig-ui
WORKDIR /mig-ui

# Install Yarn from vendored tarball (not internet, not raw JS)
COPY third-party/yarn-v1.22.22.tar.gz /tmp/yarn.tar.gz
RUN npm install -g /tmp/yarn.tar.gz && rm /tmp/yarn.tar.gz

# Configure Yarn for offline mirror
RUN echo 'yarn-offline-mirror "/mig-ui/.yarn-cache"' >> .yarnrc && \
    echo 'yarn-offline-mirror-pruning false' >> .yarnrc

# Install dependencies and build using offline cache
RUN yarn install --offline --frozen-lockfile && \
    yarn build && \
    rm -rf /mig-ui/.yarn-cache /mig-ui/src /mig-ui/config /mig-ui/scripts /mig-ui/tests

# Production image
FROM registry.access.redhat.com/ubi8/nodejs-16

COPY --from=builder /mig-ui/dist /opt/app-root/src/staticroot
COPY --from=builder /mig-ui/public/favicon.ico /opt/app-root/src/staticroot
COPY --from=builder /mig-ui/public/crane_favicon.ico /opt/app-root/src/staticroot
COPY --from=builder /mig-ui/public/index.ejs /opt/app-root/src/staticroot
COPY --from=builder /mig-ui/deploy/main.js /opt/app-root/src
COPY --from=builder /mig-ui/node_modules /opt/app-root/src/node_modules

ENV MIGMETA_FILE="/etc/mig-ui/migmeta.json"
ENV VIEWS_DIR=/opt/app-root/src/staticroot
ENV STATIC_DIR=/opt/app-root/src/staticroot
ENV NODE_TLS_REJECT_UNAUTHORIZED="0"

USER 65534:65534
ENTRYPOINT ["node", "/opt/app-root/src/main.js"]
