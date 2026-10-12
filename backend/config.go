package main

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port       string
	JWTSecret  string
	DBPath     string
	UploadDir  string
	StaticDir  string
	PublicURL  string
	AIProvider string // mock | fal | http
	AIAPIKey   string
	AIEndpoint string
	FalModel   string
}

// loadEnvFile reads KEY=VALUE lines from a .env file. Variables already set in the
// environment win, so the file only fills in what is missing.
func loadEnvFile(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		val = strings.TrimSpace(val)
		if len(val) >= 2 && (val[0] == '"' || val[0] == '\'') {
			if end := strings.IndexByte(val[1:], val[0]); end >= 0 {
				val = val[1 : end+1]
			}
		} else if i := strings.Index(val, " #"); i >= 0 {
			val = strings.TrimSpace(val[:i])
		}
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, val)
		}
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadConfig() Config {
	loadEnvFile(".env")
	port := env("PORT", "4000")
	if _, err := strconv.Atoi(port); err != nil {
		port = "4000"
	}
	falKey := os.Getenv("FAL_KEY")
	provider := env("AI_PROVIDER", "mock")
	if os.Getenv("AI_PROVIDER") == "" && falKey != "" {
		provider = "fal"
	}
	return Config{
		Port:       port,
		JWTSecret:  env("JWT_SECRET", "dev"),
		DBPath:     env("DB_PATH", "data/jewellery.db"),
		UploadDir:  env("UPLOAD_DIR", "uploads"),
		StaticDir:  env("STATIC_DIR", "../frontend"),
		PublicURL:  strings.TrimRight(env("PUBLIC_URL", "http://localhost:"+port), "/"),
		AIProvider: provider,
		AIAPIKey:   env("AI_API_KEY", falKey),
		AIEndpoint: os.Getenv("AI_ENDPOINT"),
		FalModel:   env("FAL_MODEL", "fal-ai/gemini-25-flash-image/edit"),
	}
}
