.PHONY: dev run build docker-up docker-down

# Load .env if it exists and export all vars to child processes.
# The - prefix on include means "don't error if the file is missing".
ifneq (,$(wildcard .env))
  include .env
  export
endif


dev:
	docker compose up -d
	go run ./cmd/server/main.go


run:
	go run ./cmd/server/main.go


build:
	go build -o bin/strobe ./cmd/server/main.go


docker-up:
	docker compose up -d


docker-down:
	docker compose down
