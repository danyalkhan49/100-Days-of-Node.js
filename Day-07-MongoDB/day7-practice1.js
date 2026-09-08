const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb://127.0.0.1:27017/day7_practice';

const studentSchema = new mongoose.Schema({
    student_name: String,
    student_age: Number,
    student_grade: String
});

const Student = mongoose.model('Student', studentSchema);

async function addStudent() {
    try {
        await Student.insertMany([
            {
                student_name: 'Danial Khan',
                student_age: 20,
                student_grade: 'A'
            },
            {
                student_name: 'Sara',
                student_age: 22,
                student_grade: 'B'
            },
            {
                student_name: 'Maheen',
                student_age: 17,
                student_grade: 'A'

            }
           
        ]);
         console.log('3 Student are added successfully');

    } catch (error) {
        console.error(error);
          console.log("Error adding students:", error.message);
    }
}

async function getAllStudents() {
  try {
    const students = await Student.find();

    console.log("All Students:");
    console.log(students);
  } catch (error) {
    console.log("Error getting students:", error.message);
  }
}

async function main() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    await addStudent();
    await getAllStudents();
  } catch (error) {
    console.error('MongoDB error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error.message);
});



