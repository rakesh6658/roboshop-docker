# FROM node
# EXPOSE 8080
# WORKDIR /opt/server
# COPY package.json .
# COPY server.js .
# RUN npm install
# ENV MONGO=true
# CMD ["node", "server.js"]
FROM node:18.19.1-alpine3.19
EXPOSE 8080
RUN addgroup -S roboshop && adduser -S roboshop -G roboshop
WORKDIR /opt/server
RUN chown roboshop:roboshop /opt/server
USER roboshop
COPY package.json /opt/server/
COPY server.js /opt/server/
RUN npm install
ENV MONGO=true
CMD ["node", "server.js"]