-- Create career_mappings table
CREATE TABLE IF NOT EXISTS career_mappings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  company_id VARCHAR(255) NOT NULL,
  career_index INT NOT NULL,
  job_description_field VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_company_career (company_id, career_index)
); 