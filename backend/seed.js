const mongoose = require("mongoose");
const Patient = require("./models/Patient");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

// LOCAL DEMO ONLY: every seeded account uses the password "password" (documented in the README).
// It is stored as a bcrypt hash, like real accounts.
const DEMO_PASSWORD_HASH = bcrypt.hashSync("password", 12);

const seedData = async () => {
  try {
    // Clear existing data
    await Patient.deleteMany({});
    await User.deleteMany({});

    // Create test users
    const users = await User.insertMany([
      {
        username: "Dr. Sarah Mitchell",
        email: "doctor@demo.com",
        password: DEMO_PASSWORD_HASH,
        role: "doctor"
      },
      {
        username: "Dr. Ahmed Hassan",
        email: "doctor2@demo.com",
        password: DEMO_PASSWORD_HASH,
        role: "doctor"
      },
      {
        username: "Dr. Maria Rodriguez",
        email: "doctor3@demo.com",
        password: DEMO_PASSWORD_HASH,
        role: "doctor"
      },
      {
        username: "Ahmed Hassan",
        email: "user@demo.com",
        password: DEMO_PASSWORD_HASH,
        role: "user"
      },
      {
        username: "Fatima Al-Rashid",
        email: "user2@demo.com",
        password: DEMO_PASSWORD_HASH,
        role: "user"
      }
    ]);

    // Get doctor IDs
    const doctors = users.filter(u => u.role === "doctor");
    const patientsData = users.filter(u => u.role === "user");

    // Create test patients
    const patients = await Patient.insertMany([
      {
        name: "Ahmed Hassan",
        email: "user@demo.com",
        phone: "+1-555-0123",
        age: 72,
        symptoms: ["Memory loss", "Confusion"],
        prediction: "Mild Demented",
        assignedDoctor: doctors[0]._id,
        medicalHistory: [
          {
            date: new Date("2024-03-01"),
            diagnosis: "Mild Cognitive Impairment",
            notes: "Patient shows early signs of memory decline",
            doctor: doctors[0]._id
          }
        ],
        createdAt: new Date("2024-03-15")
      },
      {
        name: "Fatima Al-Rashid",
        email: "user2@demo.com",
        phone: "+1-555-0456",
        age: 68,
        symptoms: ["Forgetfulness"],
        prediction: "Very Mild Demented",
        assignedDoctor: doctors[1]._id,
        medicalHistory: [
          {
            date: new Date("2024-02-15"),
            diagnosis: "Very Mild Dementia",
            notes: "Regular monitoring recommended",
            doctor: doctors[1]._id
          }
        ],
        createdAt: new Date("2024-03-10")
      },
      {
        name: "Mohammed Ali",
        email: "user3@demo.com",
        phone: "+1-555-0789",
        age: 75,
        symptoms: ["Disorientation", "Mood changes"],
        prediction: "Moderate Demented",
        assignedDoctor: doctors[2]._id,
        medicalHistory: [
          {
            date: new Date("2024-01-20"),
            diagnosis: "Moderate Dementia",
            notes: "Patient requires assistance with daily activities",
            doctor: doctors[2]._id
          }
        ],
        createdAt: new Date("2024-03-08")
      },
      {
        name: "Sara Ibrahim",
        email: "user4@demo.com",
        phone: "+1-555-0321",
        age: 65,
        symptoms: ["Difficulty concentrating"],
        prediction: "Non Demented",
        // Pas de médecin assigné pour tester l'assignation
        createdAt: new Date("2024-03-05")
      },
      {
        name: "Youssef Khalil",
        email: "user5@demo.com",
        phone: "+1-555-0654",
        age: 80,
        symptoms: ["Severe memory loss", "Hallucinations"],
        prediction: "Severe Demented",
        assignedDoctor: doctors[0]._id,
        medicalHistory: [
          {
            date: new Date("2024-02-01"),
            diagnosis: "Severe Dementia",
            notes: "Patient requires 24/7 care and supervision",
            doctor: doctors[0]._id
          }
        ],
        createdAt: new Date("2024-03-01")
      }
    ]);

    console.log("Test data seeded successfully!");
    console.log(`Created ${users.length} users and ${patients.length} patients`);

  } catch (error) {
    console.error("Error seeding data:", error);
  } finally {
    mongoose.connection.close();
  }
};

// Run seeder if called directly
if (require.main === module) {
  require("dotenv").config();
  mongoose.connect(process.env.MONGO_URI)
    .then(() => {
      console.log("Connected to MongoDB");
      return seedData();
    })
    .catch(err => console.error("MongoDB connection error:", err));
}

module.exports = seedData;