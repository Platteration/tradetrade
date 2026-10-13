# Keep the supported Node 22 runtime and its image content pinned together.
# Dependabot proposes patch releases and digest updates for review.
FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
# Managed cloud builds supply --secret id=proxy_ca,src="$CODEX_PROXY_CERT".
# Ordinary builds use the image's standard CA trust. No CA enters an image layer.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; \
    fi; \
    npm ci --strict-ssl=true --no-audit --no-fund

FROM base AS build
ENV BUILD_STANDALONE=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build && chmod -R a=rX .next/standalone .next/static public

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:ec2313763dd43931543bd03830466e0c409ce73a487e8d46f10db72d3b816c1c AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
# Ship no shell, npm or package manager. Application files remain owned by root.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health', {signal: AbortSignal.timeout(3000)}).then(async r => { if (!r.ok || (await r.json()).status !== 'ok') process.exit(1); }).catch(() => process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["server.js"]
