#!/bin/bash

# Export database schema and data
echo "Exporting database schema and data..."

# Get database credentials from .env
source .env

# Extract connection details
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')

# Create exports directory
mkdir -p exports

# Export schema only
echo "Exporting schema..."
pg_dump -U $DB_USER -h $DB_HOST -p $DB_PORT -d $DB_NAME --schema-only --no-owner --no-acl > exports/schema.sql

# Export data for important tables (optional)
echo "Exporting essential data..."
pg_dump -U $DB_USER -h $DB_HOST -p $DB_PORT -d $DB_NAME \
  --data-only \
  --no-owner \
  --no-acl \
  --table=tokens_unified \
  --table=bonding_curve_mappings \
  > exports/essential_data.sql

# Create a minimal setup with just schema
echo "Creating minimal setup file..."
cat > exports/minimal_setup.sql << 'EOF'
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

EOF

# Append schema
cat exports/schema.sql >> exports/minimal_setup.sql

echo "Export complete!"
echo "Files created:"
echo "  - exports/schema.sql (schema only)"
echo "  - exports/essential_data.sql (token data)"
echo "  - exports/minimal_setup.sql (ready to import)"