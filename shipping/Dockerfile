# ---------- Stage 1: Build ----------
FROM maven:3.8.6-openjdk-11-slim AS build

WORKDIR /opt/shipping

COPY pom.xml .
RUN mvn dependency:resolve

COPY src ./src
RUN mvn package -DskipTests


# ---------- Stage 2: Runtime ----------
FROM openjdk:8-jre-alpine3.9

EXPOSE 8080

WORKDIR /opt/shipping

# Environment variables
ENV CART_ENDPOINT=cart:8080
ENV DB_HOST=mysql

# Copy built JAR from the build stage
COPY --from=build /opt/shipping/target/shipping-1.0.jar shipping.jar

# Reduce memory usage to avoid OOM issues
CMD ["java", "-Xms64m", "-Xmx192m", "-jar", "shipping.jar"]
