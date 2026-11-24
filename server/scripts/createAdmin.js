'use strict';

require('dotenv').config();
const { connectDB } = require('../config/database');
const AdminUser = require('../models/AdminUser');
const { hashPassword } = require('../utils/password');

async function main() {
  await connectDB();

  const email = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@example.invalid';
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'AdminPassword123!';
  const name = process.env.ADMIN_BOOTSTRAP_NAME || 'Super Administrator';

  const existing = await AdminUser.findOne({ email });
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    process.exit(0);
  }

  const passwordHash = await hashPassword(password);
  await AdminUser.create({
    email,
    name,
    passwordHash,
    isActive: true,
  });

  console.log(`\n✅ Administrator account provisioned successfully!`);
  console.log(`   Email: ${email}`);
  console.log(`   Name : ${name}`);
  console.log(`   Pass : (as set in environment)\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
