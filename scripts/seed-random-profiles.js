'use strict';

/**
 * PENZO — Seed 10 Candidate & 10 Volunteer Profiles with Excel Data
 *
 * Requirements:
 * 1. Clear database: delete previous users, profiles, notifications, requests, sessions, old logs.
 * 2. Keep ONLY the first 2 examinations:
 *    - SSC Combined Graduate Level Examination
 *    - TNPSC - GROUP 1
 * 3. Keep AdminUser so administrative access remains operational.
 * 4. Parse the provided 56 student records.
 * 5. Randomly select 10 Candidates and 10 Volunteers.
 * 6. Set passwords exactly as in the Excel sheet (hashed with scrypt).
 * 7. Fully populate candidate and volunteer profiles.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { hashPassword } = require('../server/utils/password');

const rawCsvData = `
,26mx101,Mr Agilesh N V,Mr.,7/30/2005,1/257 Ganapathi Nagar Boyampalayam First Street,Tirupur,Tamil Nadu,641602,India,26mx101@psgtech.ac.in,9080632150,Male,26mx101,26mx101
,26mx102,Mr. Aloysus Maria Raj,Ms.,2001-11-02,"L47, TNHB colony , rajiv gandhi nagar , sowripalayam.",Coimbatore,Tamilnadu,641028,India,26mx102@psgtech.ac.in,8940442001,Male,26mx102,26mx102
,26MX103,Ms Amritha varshini S,Ms.,12/13/2005,"141,pkd nagar 1 st street peelamedu Coimbatore 641004",Coimbatore,Tamilnadu,641004,India,26mx103@psgtech.ac.in,9786833444,Female,26MX103,26MX103
,26MX104,Ms. Bharathi S,Ms.,8/15/2004,"7/166, Poolakattu thottam, Munduvelampatti, Dharapuram(Tk), Tiruppur(Dt).",Tiruppur,Tamil Nadu,642206,India,26mx104@psgtech.ac.in,8072132864,Female,26MX104,26MX104
,26MX105,Mr DHARSHAN RANGANATHAN N R,Mr.,3/23/2006,"1/475 A NMR ILLAM,Neelambur",Coimbatore,TamilNadu,641062,India,26mx105@psgtech.ac.in,7305485761,Male,26mx105,26mx105
,26MX106,Mr Dheena dhayal M,Mr.,2/20/2006,"6/122f Kaveri nagar,sakthi Nagar,vellalur -641111",Coimbatore,Tamilnadu,641111,India,26mx106@psgtech.ac.in,9790079320,Male,26MX106,26MX106
,26mx107,Mr Harishkumar S,Mr.,2004-07-12,"Perumal Kovil Street , vembadithalam, salem",Salem,Tamilnadu,637504,India,26mx107@psgtech.ac.in,7871240067,Male,26mx107,26mx107
,26mx108,Mr Jayakumar,Mr.,2005-07-10,"2/282-1, Thekkalur PO, Avinashi Thaluk, Tirupur",Tirupur,Tamilnadu,641654,India,26mx108@psgtech.ac.in,7092058338,Male,26mx108,26mx108
,26MX109,KARTHIKAA N,Mr.,2006-03-01,"8/69, BAGATHUR, SIRUMUGAI (PO), METTUPALAYAM.",COIMBATORE,TAMIL NADU,641302,INDIA,26MX109@psgtech.ac.in,6369881184,Female,26MX109,26MX109
,26mx110,Mr.karthikeyn s,,6/26/2005,"Krishnar street,Mudiyanoor,Mallanginar",Virudhunagar,Tamil Nadu,626109,India,26mx110@psgtech.ac.in,9345218984,Male,26mx110,26mx110
,26MX111,Ms KARTHIKEYINI K,Ms.,7/22/2005,"6/302, South street, Selakkarichal,sulur, Coimbatore 641658",Coimbatore,Tamilnadu,641658,India,26mx111@psgtech.ac.in,8870499002,Female,26mx111,26mx111
,26MX112,Ms Kavyadharshini S,Ms.,2004-04-10,"8,V.O.C Street 2nd Cross road,Karur",Karur,Tamil Nadu,639001,India,26mx112@psgtech.ac.in,6369730726,Female,26mx112,26mx112
,26MX113,Ms. MAYUKA S,Ms.,2004-03-12,"TYPE 4/16, INCOME TAX & CENTRAL EXCISE STAFF QUARTERS, C.K COLONY, NEW SIDDAPUDUR, COIMBATORE -641044",COIMBATORE,TAMIL NADU,641044,INDIA,26mx113@psgtech.ac.in,7708302147,Female,26MX113,26MX113
,26MX114,Ms Megha Varshini S,Ms.,2006-09-04,"786,AD Colony,Vilankuruchi Road, peelamedu, coimbatore",Coimbatore,Tamil Nadu,641004,India,26mx114@psgtech.ac.in,8870497217,Female,26MX114,26MX114
,26MX115,Mr Mohamed Abdul Basith A A,Mr.,2/21/2006,"14c/9 Kamarajar Colony 3rd Street, jaihindpuram, Madurai",Madurai,Tamilnadu,625011,India,26mx115@psgtech.ac.in,7092082709,Male,26MX115,26MX115
,26MX116,Mridula ST,Ms.,2/13/2006,"23b,ramalinga adigalar street,nehru nagar,civil aerodrome post cbe-641014",Coimbatore,Tamilnadu,641014,India,mridulathulasirajan@gmail.com,9042561306,Female,26MX116,26MX116
,26MX117,Ms. Nivedhitha G,Ms.,12/24/2005,"234,Ketchen Kinaru, Pogalur(via), Vadavalli(post)",Coimbatore,Tamil Nadu,641697,India,26mx117@psgtech.ac.in,6383464381,Female,26mx117,26mx117
,26mx118,Mr. Parithi R,Mr.,2001-09-06,"G1, KAPV govt medical college, Periyamilaguparai, Trichy - 01",Trichy,Tamil nadu,620001,India,26mx118@psgtech.ac.in,6383142372,Male,26mx118,26mx118
,26MX119,Ms Poorani C,Ms.,7/23/2004,"104,kumilanparappu, chithode (PO),Erode",Erode,Tamilnadu,638102,India,26mx119@psgtech.ac.in,9342836833,Female,26MX119,26MX119
,26MX120,PRIYA DHARSHINI R,Ms.,20.11.2003,"231/4, Mettu street , Nalatinputhur, Kovilpatti, Thoothukudi-628716",Coimbatore,Tamil Nadu,641046,India,26mx120@psgtech.ac.in,7904042380,Female,26MX120,26MX120
,26MX121,Ms.Rebakha Snowit M,Ms.,10/18/2004,"40/C,CSI Church backside, Panagudi",Tirunelveli,Tamil Nadu,627109,India,26mx121@psgtech.ac.in,8825521935,Female,26mx121,26mx121
,26mx122,Mr Sanjay K,Mr.,6/17/2006,"155/1, KARUPEY GOUNDER STREET",Coimbatore,Tamil Nadu,641105,India,26mx122@psgtech.ac.in,7604965049,Male,26mx122,26mx122
,26MX123,Mr Santhosh Sivaraman,Mr.,2/22/2006,"Middle Street, Rajendrapattinam,cuddalore",Virudhachalam,Tamil Nadu,608 703,India,26mx123@psgtech.ac.in,9524054374,Male,26mx123,26mx123
,26MX124,Ms.R.sharmila,Ms.,2005-10-08,"28B,chetti North Street,kelvilur, velankanni, Nagapattinam",Nagapattinam,Tamil Nadu,611111,India,26MX124@psgtech.ac.in,8122968657,Female,26MX124,26MX124
,26MX125,MR.SIVARANJAN R,Mr.,6/29/2005,"Type 1/no.7,CPWD Block,INCOMETAX /Central excise staff Qtrs,New sidhapudur coimbatore.",Coimbatore,Tamilnadu,641044,India,26mx125@psgtech.ac.in,9842249008,Male,26mx125,26mx125
,26MX126,Mr Sivasudhan Rajasekar,Ms.,2006-04-01,"97, vnr main road, Aps kalyana Mandapam, thiruthangal",Sivakasi,Tamilnadu,626130,India,26mx126@psgtech.ac.in,8489560708,Male,26mx126,26mx126
,26MX127,Vyshnavi K,Ms.,2/21/2005,"169/1, Ayyampettai, Thumbal po, Attur tk, Salem -636114",Salem,Tamil Nadu,636114,India,26mx127@psgtech.ac.in,9025228863,Female,26MX127,26MX127
,26mx128,Mr. Yajat Dev V,Mr.,2005-10-04,"Plot no 27, behind super bakes, 80 feet road, olymbus, Ramanathapuram, coimbatore -641045",Coimbatore,Tamil Nadu,641045,India,26mx128@psgtech.ac.in,8148085073,Male,26mx128,26mx128
,26MX129,Mr Yuvan Prasath B,Mr.,5/25/2005,"142, Padake Gounder Street, Ondipudur, Coimbatore South, Coimbatore, Tamil Nadu - 641016",Coimbatore,Tam,641016,India,26mx129@psgtech.ac.in,6379120712,Male,26mx129,26mx129
,26MX201,Ms Affrin Jawahar S,Ms.,1/21/2006,"66,Ramaswamy Layout,Ellaithottam rd,2nd cross,Peelamedu,Coimbatore-04",Coimbatore,Tamil nadu,641004,India,26mx201@psgtech.ac.in,9363313435,Female,26MX201,26MX201
,26mx202,Ms. Anandha Lakshmi B,Ms.,2004-01-10,"No.08, Shambhavi Nagar, Peenya 2nd stage, Bengaluru - 560058",Bengaluru,Karnataka,560058,India,26mx202@psgtech.ac.in,6361926887,Female,26mx202,26mx202
,26mx203,Ms Deepa Dharshini G,Ms.,2/23/2005,"6/435,main road Ilayarasanendal Kovilpatti, thirunelveli,pin code:627713",Tirunelveli,Tamilnadu,627713,Indian,26mx203@psgtech.ac.in,8489064189,Female,26mx203,26mx203
,26MX205,Mr HARESH S,Mr.,2006-11-03,"63,ramanashree",madur,Tamil Nadu,625011,India,26mx205@psgtech.ac.in,9345642920,Male,26mx205,26mx205
,26MX206,HARI PRASANTH S,Mr.,2005-03-08,"15/80, T K PUDUR ROAD, ZAMIN UTHUKULI, POLLACHI",POLLACHI,TAMILNADU,642004,INDIA,26mx206@psgtech.ac.in,8667034780,Male,26MX206,26MX206
,26MX207,Ms HARSHINI G,Ms.,2005-06-06,"M - 10 RM COLONY, 7TH CROSS, NEAR SIVAN KOVIL",DINDIGUL,TAMILNADU,624001,INDIA,26mx207@psgtech.ac.in,9597996416,Female,26MX207,26MX207
,26MX208,Ms KAVYATHARSHINI P,Ms.,6/16/2006,"5/97, Sinthagoundanpalayam, vembathi,bhavani.",Erode,Tamilnadu,638315,India,26mx208@psgtech.ac.in,9489601058,Female,26MX208,26MX208
,26MX209,Mr. Laxman B,Mr.,6/18/2001,"19. NMK Street, Ayanavaram, Chennai-23.",Chennai,Tamil Nadu,600023,India,26mx209@psgtech.ac.in,8778331376,Male,26mx209,26mx209
,26MX210,Ms.S.Mirdulla,Ms.,2006-09-01,"G-13, anugraha appartment,Kamarajar road,Peelamedu,coimbatore -641004",Coimbatore,Coimbatore,641 004,India,26mx210@psgtech.ac.in,9385944569,Female,26MX210,26MX210
,26MX211,MOHANRAJ N,Mr.,12/22/2005,"229/1, SVM STREET, SENTHIL NAGAR, SOMANUR, COIMBATORE",Coimbatore,Tamil Nadu,641668,India,26mx211@psgtech.ac.in,9025362086,Male,26MX211,26MX211
,26MX212,Ms Nyantara Lakshmi D S,Ms.,2005-04-03,"22,Ranganathapuram,street-4,Uppilipalayam,Cbe-15",Coimbatore,Tamil Nadu,641015,India,nyantaralakshmi@gmail.com,6380779027,Female,26MX212,26MX212
,26MX214,Ms Poojasri S,Ms.,1/20/2006,"2C/6A balaguru garden, Peelamedu,Coimbatore.",Coimbatore,Tamil Nadu,641004,India,26MX214@psgtech.ac.in,8838515850,Female,26MX214,26MX214
,26MX215,Ms. RATHNA SHRI B,Ms.,10/20/2005,"33/30, Chettiyar Street, Mettupalayam (Po),Musiri(Tk),Trichy(Dt)-621210",Trichy,Tamil Nadu,621210,India,26mx215@psgtech.ac.in,7845442045,Female,26MX215,26MX215
,26MX216,Samrithi Ramesh,Ms.,7/26/2005,"3/15 Mahalakshimi Nagar, Ellis post, Pollachi road, Dharapuram - 638657.",Dharapuram,Tamil Nadu,638657,India,26MX216@psgtech.ac.in,6380982947,Female,26MX216,26MX216
,26MX217,SANJIVKUMAR A,Mr.,11/19/2005,"14,A jaya Nagar 2nd Street Neelikonampalayam Coimbatore",Coimbatore,Tamilnadu,641033,India,26mx217@psgtech.ac.in,9043872476,Male,26MX217,26MX217
,26MX218,Ms SANTHIYA T,Ms.,12/17/2005,"138, Extension Main street no1,Ananian kadu Road, Singanallur,cbe",Coimbatore,Tamilnadu,641005,India,26MX218@psgtech.ac.in,9344892975,Female,26MX218,26MX218
,26MX219,Ms.Shwetha P,Ms.,2006-06-03,"2/8 Savithiri nagar, Vilankurichi road, Coimbatore",Coimbatore,Tamilnadu,641004,India,26MX219@psgtech.ac.in,9042692063,Female,26MX219,26MX219
,26MX220,Mr Siva prasath Sivakumar,Ms.,8/16/2005,"29/2A kulandhaivel street, Mannargudi, Thiruvarur",Coimbatore,Tamilnadu,641004,India,26mx220@psgtech.ac.in,6380585516,Male,26MX220,26MX220
,26MX221,Ms SOFIYA A,Ms.,2005-08-04,"16, Chinnammal Street,Saradha Mill Road Podanur - Coimbatore 641023",Coimbatore,Tamilnadu,641023,India,26mx221@psgtech.ac.in,9843295892,Female,26MX221,26MX221
,26MX222,Mr.Srigowshikram D,Mr.,2006-06-01,"1/49 keeraipappambadi Maramangalathupatti,Salem",Salem,Tamilnadu,636030,India,26mx222@psgtech.ac.in,9488557020,Male,26MX222,26MX222
,26MX223,Ms Sukantha S C,Ms.,12/31/2004,"Site no:18, R.K.K Nagar, Neelikonampalayam, Coimbatore -641033",Coimbatore,Tamilnadu,641033,India,26mx223@psgtech.ac.in,9344639244,Female,26MX223,26mx223
,26MX224,MS.VARSHA N,Ms.,11/17/2005,"8, DEVENDRAN STREET 3RD STREET, UPPILIPALAYAM, COIMBATORE - 641015",COIMBATORE,TAMILNADU,641015,INDIA,26mx224@psgtech.ac.in,9345971275,Female,26MX224,26MX224
,26mx225,Ms varshana R,Ms.,2006-07-03,"Raja mannar thottam danishpet ,kadaiyampatti,salem",Salem,Tamilnadu,636354,India,26MX225@psgtech.ac.in,8144133199,Female,26mx225,26mx225
,26MX226,Ms Varshitaa SH,Ms.,10/20/2005,"32/105 Murugan kovil opposite, R V Nagar, Begampur post, Dindigul-624002",Dindigul,Tamilnadu,624002,India,26mx226@psgtech.ac.in,9363605705,Female,26MX226,26MX226
,26MX227,Mr.Vigneshwar,Mr.,9/21/2001,"3rd Prr Street ,Bomisamikovil Street, Chinalapatti, Dindigul",Dindigul,Tamil Nadu,624301,India,26MX227@psgtech.ac.in,8668074066,Male,26MX227,26MX227
,26MX228,Mr.S.Vigneshwaran,Mr.,2006-06-03,"279/A, Ashok Nagar near jaycees school, moolapalayam, Erode.",Erode,Tamilnadu,638002,India,26mx228@psgtech.ac.in,9080472738,Male,26mx228,26mx228
,26MX229,Ms. Vijayanivethika R G M,Ms.,10/17/2005,"9 A, A.P.P nagar, oddanchatram",Dindigul,Tamilnadu,624619,India,26mx229@psgtech.ac.in,7904290764,Female,26mx229,26mx229
`;

// Helper: robust CSV line parser handling quotes
function parseCSVRows(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
  const rows = [];

  for (const line of lines) {
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    fields.push(cur.trim());

    if (fields.length >= 14) {
      // Index mapping:
      // fields[1]: rollNo
      // fields[2]: name
      // fields[3]: salutation
      // fields[4]: dob
      // fields[5]: address
      // fields[6]: city
      // fields[7]: state
      // fields[8]: pincode
      // fields[9]: country
      // fields[10]: email
      // fields[11]: phone
      // fields[12]: gender
      // fields[13]: username
      // fields[14] or fields[fields.length - 1]: password
      rows.push({
        rollNo: fields[1],
        rawName: fields[2],
        dob: fields[4],
        address: fields[5],
        city: fields[6],
        state: fields[7],
        pincode: fields[8]?.replace(/\s/g, ''),
        email: fields[10]?.trim().toLowerCase(),
        phone: fields[11]?.trim().replace(/\D/g, '').slice(-10),
        gender: (fields[12] || '').toLowerCase().includes('female') ? 'FEMALE' : 'MALE',
        password: fields[fields.length - 1]?.trim() || fields[13]?.trim() || fields[1]?.trim(),
      });
    }
  }
  return rows;
}

function parseDob(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (s.includes('-')) {
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  if (s.includes('.')) {
    const [d, m, y] = s.split('.');
    return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  }
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 3) {
      const [m, d, y] = parts;
      return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    }
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function cleanName(n) {
  return String(n || '')
    .replace(/^(Mr|Ms|Mrs)\.?\s+/i, '')
    .trim();
}

// Deterministic or seeded shuffle
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  console.log('Connecting to MongoDB at mongodb://127.0.0.1:27017/penzo ...');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/penzo');
  console.log('Connected to MongoDB.\n');

  // Load models
  const User = require('../server/models/User');
  const CandidateProfile = require('../server/models/CandidateProfile');
  const VolunteerProfile = require('../server/models/VolunteerProfile');
  const Examination = require('../server/models/Examination');
  const ScribeRequest = require('../server/models/ScribeRequest');
  const VolunteerInterest = require('../server/models/VolunteerInterest');
  const ConfirmedAssignment = require('../server/models/ConfirmedAssignment');
  const MatchProposal = require('../server/models/MatchProposal');
  const Notification = require('../server/models/Notification');
  const Session = require('../server/models/Session');
  const AdminAuditLog = require('../server/models/AdminAuditLog');
  const RequestStatusHistory = require('../server/models/RequestStatusHistory');
  const VerificationRecord = require('../server/models/VerificationRecord');
  const ContactVerificationChallenge = require('../server/models/ContactVerificationChallenge');
  const OtpChallenge = require('../server/models/OtpChallenge');
  const SupportRequest = require('../server/models/SupportRequest');
  const VolunteerAvailability = require('../server/models/VolunteerAvailability');
  const DocumentMetadata = require('../server/models/DocumentMetadata');
  const AdminUser = require('../server/models/AdminUser');

  // ─── 1. Clear Old Logs & Previous Data ───────────────────────────────────────
  console.log('Step 1: Clearing all old logs, requests, notifications, and user data...');
  await AdminAuditLog.deleteMany({});
  await RequestStatusHistory.deleteMany({});
  await Notification.deleteMany({});
  await Session.deleteMany({});
  await ScribeRequest.deleteMany({});
  await VolunteerInterest.deleteMany({});
  await ConfirmedAssignment.deleteMany({});
  await MatchProposal.deleteMany({});
  await VerificationRecord.deleteMany({});
  await ContactVerificationChallenge.deleteMany({});
  await OtpChallenge.deleteMany({});
  await SupportRequest.deleteMany({});
  await VolunteerAvailability.deleteMany({});
  await DocumentMetadata.deleteMany({});
  await CandidateProfile.deleteMany({});
  await VolunteerProfile.deleteMany({});
  await User.deleteMany({});

  console.log('  ✓ Cleared AdminAuditLogs, RequestStatusHistories, Notifications, Sessions');
  console.log('  ✓ Cleared ScribeRequests, Assignments, Matches, Verifications, Profiles, Users');

  // ─── 2. Preserve ONLY First 2 Examinations ──────────────────────────────────
  console.log('\nStep 2: Preserving ONLY the first 2 examinations and deleting the rest...');
  const allExams = await Examination.find({}).sort({ createdAt: 1 });
  console.log(`  Found ${allExams.length} examinations in total.`);
  if (allExams.length >= 2) {
    const keepIds = [allExams[0]._id, allExams[1]._id];
    console.log(`  Keeping exam 1: "${allExams[0].name}" [${allExams[0]._id}]`);
    console.log(`  Keeping exam 2: "${allExams[1].name}" [${allExams[1]._id}]`);
    const deleteResult = await Examination.deleteMany({ _id: { $nin: keepIds } });
    console.log(`  ✓ Deleted ${deleteResult.deletedCount} examinations. Exactly 2 examinations remain.`);
  } else {
    console.log(`  ✓ ${allExams.length} examination(s) exist; kept all.`);
  }

  // Ensure AdminUser exists
  const adminCount = await AdminUser.countDocuments();
  if (adminCount === 0) {
    await AdminUser.create({
      email: 'admin@example.invalid',
      name: 'Platform Administrator',
      passwordHash: await hashPassword('AdminPassword123!'),
      isActive: true,
    });
    console.log('  ✓ Initialized Platform Administrator (admin@example.invalid)');
  }

  // ─── 3. Parse CSV Records ───────────────────────────────────────────────────
  console.log('\nStep 3: Parsing provided Excel/CSV data...');
  const allRecords = parseCSVRows(rawCsvData);
  console.log(`  ✓ Successfully parsed ${allRecords.length} student records.`);

  // ─── 4. Randomly Select 10 Candidates and 10 Volunteers ─────────────────────
  console.log('\nStep 4: Selecting 10 Candidates and 10 Volunteers randomly...');
  const shuffled = shuffle(allRecords);
  const candidateRecords = shuffled.slice(0, 10);
  const volunteerRecords = shuffled.slice(10, 20);

  const assistancePresets = [
    {
      disabilityType: 'Visual Impairment (Low Vision)',
      needs: 'Candidate requires scribe to read exam questions and enter selected responses on the OMR/computer interface.',
    },
    {
      disabilityType: 'Locomotor Disability (Right Hand Fracture)',
      needs: 'Candidate requires scribe for writing detailed subjective and mathematical answers.',
    },
    {
      disabilityType: 'Cerebral Palsy (Fine Motor Impairment)',
      needs: 'Candidate requires scribe for writing English and technical examination papers.',
    },
    {
      disabilityType: 'Visual Impairment (Total Blindness)',
      needs: 'Candidate requires scribe for reading question papers and dictating descriptive answers.',
    },
    {
      disabilityType: 'Dyslexia & Reading Difficulty',
      needs: 'Candidate needs assistance with reading questions aloud and writing dictated answers.',
    },
    {
      disabilityType: 'Muscular Dystrophy',
      needs: 'Candidate has severe handwriting fatigue; requires scribe for entire duration of exam.',
    },
  ];

  const volunteerSubjectPresets = [
    ['Computer Science', 'General Studies', 'English Literature'],
    ['Mathematics', 'General Intelligence', 'Quantitative Aptitude'],
    ['General Science', 'Indian History', 'English Comprehension'],
    ['Computer Applications', 'Reasoning Ability', 'Tamil'],
    ['Social Studies', 'Current Affairs', 'Logical Reasoning'],
  ];

  const now = new Date();

  // ─── 5. Insert 10 Candidates ────────────────────────────────────────────────
  console.log('\nStep 5: Creating 10 Candidate profiles with password from Excel...');
  const createdCandidates = [];

  for (let i = 0; i < candidateRecords.length; i++) {
    const rec = candidateRecords[i];
    const name = cleanName(rec.rawName);
    const parts = name.split(' ');
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ') || firstName;
    const mobileE164 = `+91${rec.phone}`;
    const password = rec.password;
    const passwordHash = await hashPassword(password);
    const preset = assistancePresets[i % assistancePresets.length];

    const user = await User.create({
      role: 'CANDIDATE',
      name,
      email: rec.email,
      mobileE164,
      primaryIdentifier: 'EMAIL',
      passwordHash,
      authProvider: 'PASSWORD',
      status: 'ACTIVE',
      profileComplete: true,
      verificationStatus: 'VERIFIED',
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      lastLoginAt: null,
    });

    const profile = await CandidateProfile.create({
      userId: user._id,
      fullName: name,
      firstName,
      lastName,
      dateOfBirth: parseDob(rec.dob),
      gender: rec.gender,
      languages: ['English', 'Tamil'],
      preferredLanguages: ['English', 'Tamil'],
      qualification: 'BCA / B.Sc Computer Science',
      currentlyPursuing: 'Currently Pursuing MCA',
      education: 'BCA / B.Sc Computer Science',
      city: rec.city || 'Coimbatore',
      preferredExamCity: rec.city || 'Coimbatore',
      state: rec.state || 'Tamil Nadu',
      pincode: rec.pincode || '641004',
      disabilityType: preset.disabilityType,
      disabilityDescription: preset.needs,
      assistanceNeeds: preset.needs,
      completionPercentage: 100,
      verificationStatus: 'VERIFIED',
    });

    await VerificationRecord.create([
      { userId: user._id, kind: 'IDENTITY', status: 'VERIFIED', reviewedAt: now },
      { userId: user._id, kind: 'ASSISTANCE_NEED', status: 'VERIFIED', reviewedAt: now },
    ]);

    createdCandidates.push({
      rollNo: rec.rollNo,
      name,
      email: rec.email,
      mobile: mobileE164,
      password: rec.password,
      city: rec.city,
      gender: rec.gender,
    });
  }

  // ─── 6. Insert 10 Volunteers ────────────────────────────────────────────────
  console.log('\nStep 6: Creating 10 Volunteer profiles with password from Excel...');
  const createdVolunteers = [];

  for (let i = 0; i < volunteerRecords.length; i++) {
    const rec = volunteerRecords[i];
    const name = cleanName(rec.rawName);
    const parts = name.split(' ');
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ') || firstName;
    const mobileE164 = `+91${rec.phone}`;
    const password = rec.password;
    const passwordHash = await hashPassword(password);
    const subjects = volunteerSubjectPresets[i % volunteerSubjectPresets.length];

    const user = await User.create({
      role: 'VOLUNTEER',
      name,
      email: rec.email,
      mobileE164,
      primaryIdentifier: 'EMAIL',
      passwordHash,
      authProvider: 'PASSWORD',
      status: 'ACTIVE',
      profileComplete: true,
      verificationStatus: 'VERIFIED',
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      lastLoginAt: null,
    });

    const profile = await VolunteerProfile.create({
      userId: user._id,
      fullName: name,
      firstName,
      lastName,
      dateOfBirth: parseDob(rec.dob),
      gender: rec.gender,
      languages: ['English', 'Tamil'],
      subjects,
      city: rec.city || 'Coimbatore',
      state: rec.state || 'Tamil Nadu',
      pincode: rec.pincode || '641004',
      serviceRadiusKm: 25,
      serviceLocations: [rec.city || 'Coimbatore'],
      hasPriorExperience: i % 2 === 0,
      hasScribeExperience: i % 2 === 0,
      previousScribeCount: i % 2 === 0 ? (i + 1) : 0,
      bio: `PSG Tech MCA student eager to assist examination candidates as a volunteer scribe in ${rec.city || 'Coimbatore'}.`,
      completionPercentage: 100,
      verificationStatus: 'VERIFIED',
    });

    await VerificationRecord.create([
      { userId: user._id, kind: 'IDENTITY', status: 'VERIFIED', reviewedAt: now },
    ]);

    createdVolunteers.push({
      rollNo: rec.rollNo,
      name,
      email: rec.email,
      mobile: mobileE164,
      password: rec.password,
      city: rec.city,
      gender: rec.gender,
    });
  }

  // ─── Verification Report ────────────────────────────────────────────────────
  console.log('\n========================================================================================');
  console.log('                          10 CANDIDATE PROFILES CREATED');
  console.log('========================================================================================');
  console.table(createdCandidates);

  console.log('\n========================================================================================');
  console.log('                          10 VOLUNTEER PROFILES CREATED');
  console.log('========================================================================================');
  console.table(createdVolunteers);

  const remainingExams = await Examination.find({}, 'name slug createdAt');
  console.log('\n========================================================================================');
  console.log(` REMAINING EXAMINATIONS IN DATABASE (${remainingExams.length} TOTAL)`);
  console.log('========================================================================================');
  remainingExams.forEach((e, idx) => console.log(` ${idx + 1}. [${e._id}] ${e.name}`));

  const userCount = await User.countDocuments();
  const candCount = await CandidateProfile.countDocuments();
  const volCount = await VolunteerProfile.countDocuments();
  const auditCount = await AdminAuditLog.countDocuments();
  const notifCount = await Notification.countDocuments();

  console.log('\n========================================================================================');
  console.log(' SUMMARY VERIFICATION:');
  console.log(`  - Users in DB: ${userCount} (10 Candidates + 10 Volunteers)`);
  console.log(`  - Candidate Profiles: ${candCount}`);
  console.log(`  - Volunteer Profiles: ${volCount}`);
  console.log(`  - Audit Logs: ${auditCount} (cleared)`);
  console.log(`  - Notifications: ${notifCount} (cleared)`);
  console.log(`  - Examinations: ${remainingExams.length} (exactly first 2 preserved)`);
  console.log('========================================================================================\n');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Fatal error during seed:', err);
  process.exit(1);
});
