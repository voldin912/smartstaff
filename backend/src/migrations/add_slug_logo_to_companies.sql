-- Migration: Add slug and logo columns to companies table
-- Run this script to update existing database installations

ALTER TABLE companies 
ADD COLUMN slug VARCHAR(255) UNIQUE AFTER name,
ADD COLUMN logo VARCHAR(255) AFTER slug;

-- Update existing companies to have slugs based on their names
UPDATE companies 
SET slug = LOWER(REPLACE(REPLACE(REPLACE(name, ' ', '-'), '.', ''), ',', ''))
WHERE slug IS NULL;

-- Make slug NOT NULL after populating existing records
ALTER TABLE companies MODIFY COLUMN slug VARCHAR(255) NOT NULL UNIQUE; 