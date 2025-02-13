FROM node:22-alpine

WORKDIR /app
COPY [ "license.md", "package.json", "package-lock.json", "./"]
COPY [ ".env", "./"]
COPY [ "src/", "./src/" ]

RUN npm install

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
ENV PLUGINS=image-plugin,graph-plugin

# Avoid running as root
USER node


CMD [ "npm", "run", "start_no_env" ]
