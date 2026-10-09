CREATE DATABASE IF NOT EXISTS ai_emergency_response
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ai_emergency_response;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin','user') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incidents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    incident_type VARCHAR(100) NULL,
    summary TEXT NULL,
    location_text VARCHAR(500) NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    people_affected INT NULL,
    vulnerable_people TEXT NULL,
    resource_needed VARCHAR(255) NULL,
    urgency ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
    status ENUM('active','rescue_in_progress','resolved') NOT NULL DEFAULT 'active',
    confidence DECIMAL(5,4) NULL,
    verified TINYINT(1) NOT NULL DEFAULT 0,
    last_ai_note TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_incident_status (status),
    INDEX idx_incident_updated (updated_at),
    INDEX idx_incident_location (latitude, longitude)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    incident_id INT NULL,
    channel ENUM('text','photo','voice','multimodal') NOT NULL DEFAULT 'text',
    message_text TEXT NULL,
    photo_path VARCHAR(500) NULL,
    audio_path VARCHAR(500) NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    ai_json JSON NULL,
    ai_status ENUM('pending','processed','rejected','error') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reports_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_reports_incident
        FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE SET NULL,
    INDEX idx_reports_incident (incident_id),
    INDEX idx_reports_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    accuracy DECIMAL(10,2) NULL,
    is_live TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_live_user (user_id),
    CONSTRAINT fk_locations_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


-- Safe migration for an existing database:
ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS admin_note TEXT NULL;


ALTER TABLE incidents ADD COLUMN IF NOT EXISTS progress_percent INT NOT NULL DEFAULT 20;

CREATE TABLE IF NOT EXISTS incident_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    incident_id INT NOT NULL,
    actor_user_id INT NULL,
    event_type VARCHAR(80) NOT NULL,
    message TEXT NOT NULL,
    old_status VARCHAR(40) NULL,
    new_status VARCHAR(40) NULL,
    progress_percent INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_event_incident FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
    CONSTRAINT fk_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_event_incident (incident_id),
    INDEX idx_event_created (created_at)
) ENGINE=InnoDB;
