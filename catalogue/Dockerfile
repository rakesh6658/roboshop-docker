# FROM node
# EXPOSE 8080
# WORKDIR /opt/server
# COPY package.json .
# COPY server.js .
# RUN npm install
# ENV MONGO=true
# CMD ["node", "server.js"]
FROM node:18

WORKDIR /opt/server

COPY package.json .

RUN npm install

COPY server.js .

EXPOSE 8080

CMD ["node", "server.js"]
