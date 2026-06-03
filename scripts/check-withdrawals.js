import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

async function checkWithdrawals() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, { 
      dbName: 'fonbet',
      bufferCommands: false,
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      family: 4
    });

    const financeTx = mongoose.connection.db.collection('forcelabfinancialtransactions');

    // Check all withdrawals
    console.log('\n=== ALL WITHDRAWALS (no filter) ===');
    const allWithdrawals = await financeTx.find({
      providerType: { $in: ['withdraw', 'withdrawal'] }
    }).limit(10).toArray();
    console.log(`Found: ${allWithdrawals.length} withdrawals`);
    allWithdrawals.forEach((w, i) => {
      console.log(`${i + 1}. user: ${w.user}, amount: ${w.amount}, status: ${w.status}, date: ${w.createdAt}`);
    });

    // Check approved withdrawals
    console.log('\n=== APPROVED WITHDRAWALS ===');
    const approvedWithdrawals = await financeTx.find({
      providerType: { $in: ['withdraw', 'withdrawal'] },
      status: 'approved'
    }).limit(10).toArray();
    console.log(`Found: ${approvedWithdrawals.length} approved withdrawals`);
    approvedWithdrawals.forEach((w, i) => {
      console.log(`${i + 1}. user: ${w.user}, amount: ${w.amount}, date: ${w.createdAt}`);
    });

    // Check this month's approved withdrawals
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    monthEnd.setMilliseconds(-1);

    console.log(`\n=== THIS MONTH APPROVED WITHDRAWALS (${monthStart.toISOString()} to ${monthEnd.toISOString()}) ===`);
    const monthWithdrawals = await financeTx.find({
      providerType: { $in: ['withdraw', 'withdrawal'] },
      status: 'approved',
      createdAt: { $gte: monthStart, $lte: monthEnd }
    }).limit(10).toArray();
    console.log(`Found: ${monthWithdrawals.length} this month's approved withdrawals`);
    monthWithdrawals.forEach((w, i) => {
      console.log(`${i + 1}. user: ${w.user}, amount: ${w.amount}, date: ${w.createdAt}`);
    });

    // Check status values distribution
    console.log('\n=== STATUS DISTRIBUTION ===');
    const statusDistribution = await financeTx.aggregate([
      { $match: { providerType: { $in: ['withdraw', 'withdrawal'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]).toArray();
    statusDistribution.forEach(s => {
      console.log(`${s._id}: ${s.count}`);
    });

    await mongoose.disconnect();
    console.log('\n✓ Done');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkWithdrawals();
