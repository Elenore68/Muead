// Must be imported FIRST by every test file: modules read these at import time. No AWS call is ever made.
process.env.TABLE_NAME = "muead-test-main";
process.env.BUCKET_NAME = "muead-test-files";
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
