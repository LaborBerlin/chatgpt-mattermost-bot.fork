# NPM builder image
FROM node:22-alpine AS npm_builder

WORKDIR /app
COPY [ "package.json", "package-lock.json", "./"]
COPY [ ".env", "./"]
COPY [ "src/", "./src/" ]

#RUN npm ci --omit dev
#RUN npm run build

RUN npm install
RUN npm install -g tsx

# NPM runtime image
FROM node:22-alpine AS npm_runtime

WORKDIR /app

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
ENV PLUGINS=image-plugin,graph-plugin

# Avoid running as root:
USER node

#COPY --from=npm_builder [ "/app/node_modules/", "./node_modules/" ]
#COPY --from=npm_builder [ "/app/dist/", "./src/" ]
COPY [ "./license.md", "./" ]

ENTRYPOINT [ "tsx", "--env-file=.env", "./src/botservice.ts" ]
