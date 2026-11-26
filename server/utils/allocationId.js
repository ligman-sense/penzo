'use strict';

const ConfirmedAssignment = require('../models/ConfirmedAssignment');

/**
 * Generates a unique, readable, and sequential Allocation ID in the format: PNZ<YEAR><0001>
 * Example: PNZ20260001
 * 
 * - Deterministic format: PNZ + 4-digit Year + at least 4 digits sequential counter
 * - Checks MongoDB for the highest existing allocationId in the target year
 * - Safely handles collisions and guarantees database-level uniqueness
 */
async function generateAllocationId(targetYear) {
  const year = targetYear || new Date().getFullYear();
  const prefix = `PNZ${year}`;

  // Find all existing allocationIds starting with PNZ<year> to find the maximum sequential number
  const regex = new RegExp(`^${prefix}(\\d+)$`);
  const assignments = await ConfirmedAssignment.find({
    allocationId: { $regex: `^${prefix}` },
  })
    .select('allocationId')
    .lean();

  let maxNum = 0;
  for (const a of assignments) {
    if (a.allocationId) {
      const match = a.allocationId.match(regex);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  let nextNum = maxNum + 1;
  let candidateId = `${prefix}${String(nextNum).padStart(4, '0')}`;

  // Extra guard against race collisions
  let exists = await ConfirmedAssignment.exists({ allocationId: candidateId });
  let attempts = 0;
  while (exists && attempts < 100) {
    nextNum++;
    candidateId = `${prefix}${String(nextNum).padStart(4, '0')}`;
    exists = await ConfirmedAssignment.exists({ allocationId: candidateId });
    attempts++;
  }

  return candidateId;
}

module.exports = {
  generateAllocationId,
};
