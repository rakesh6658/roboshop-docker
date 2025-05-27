FROM node:14.21.3-alpine3.17
EXPOSE 8080
RUN addgroup -S cart && adduser -S cart cart
WORKDIR /opt/server
RUN chown -R cart:cart /opt/server
USER cart
COPY package.json .
COPY server.js .
RUN npm install
CMD ["node", "server.js"]