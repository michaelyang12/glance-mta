package config

import (
    "os"
    "time"

    "gopkg.in/yaml.v3"
)

type Config struct {
    Server  ServerConfig  `yaml:"server"`
    Polling PollingConfig `yaml:"polling"`
    Feeds   map[string]string `yaml:"feeds"`
}

type ServerConfig struct {
    Port int `yaml:"port"`
}

type PollingConfig struct {
    Interval             time.Duration `yaml:"interval"`
    ArrivalsPerDirection int           `yaml:"arrivals_per_direction"`
}

func Load(path string) (*Config, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()

    var cfg Config
    decoder := yaml.NewDecoder(f)
    if err := decoder.Decode(&cfg); err != nil {
        return nil, err
    }

    return &cfg, nil
}
