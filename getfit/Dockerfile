# GetFit API — production image.
#
# Built from the workspace root because the server imports @getfit/shared, which
# has to be compiled before the server can be. The final stage carries only the
# compiled output and production dependencies.

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Manifests first, so a dependency install is only redone when they change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/mobile/package.json packages/mobile/

# The mobile workspace is never built here, but npm needs its manifest to
# resolve the workspace graph.
RUN npm ci --workspace @getfit/shared --workspace @getfit/server --include-workspace-root

COPY packages/shared packages/shared
COPY packages/server packages/server

# Compiles the shared package first, then the server, and copies the SQL
# migrations next to the compiled migration runner.
RUN npm run build:server

# Drops dev dependencies from the tree that gets copied forward.
RUN npm prune --omit=dev --workspace @getfit/shared --workspace @getfit/server --include-workspace-root

# --------------------------------------------------------------- runtime stage
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

# Runs unprivileged; the node image already provides this user.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/server/package.json ./packages/server/package.json
COPY --from=build --chown=node:node /app/packages/server/dist ./packages/server/dist

USER node
EXPOSE 8080

# The seed entry point migrates and then reseeds the exercise reference data,
# so a deploy can never serve a schema or a library it does not have. Every
# insert is an upsert, which makes this safe on every boot.
CMD ["sh", "-c", "node packages/server/dist/db/seed.js && node packages/server/dist/index.js"]
