const mongoose = require('mongoose');

async function run() {
    try {
        await mongoose.connect('mongodb://127.0.0.1:27017/practiceDB');
        console.log('Connected to MongoDB');

        const studentSchema = new mongoose.Schema({
            name: String,
            age: Number,
            grade: String
        });

        const Student = mongoose.models.Student || mongoose.model('Student', studentSchema);

        // Clear the demo collection so the script can be run repeatedly.
        await Student.deleteMany({});

        await Student.insertMany([
            { name: 'Ali', age: 20, grade: 'A' },
            { name: 'Sara', age: 17, grade: 'B' },
            { name: 'Ahmed', age: 22, grade: 'A' },
            { name: 'Hina', age: 16, grade: 'C' },
            { name: 'Bilal', age: 19, grade: 'A' }
        ]);
        console.log('5 students added!');

        const topStudents = await Student.find({ grade: 'A' });
        console.log('Grade A students:');
        console.log(topStudents);

        const olderStudents = await Student.find({ age: { $gt: 18 } });
        console.log('Students older than 18:');
        console.log(olderStudents);
    } catch (err) {
        console.error('Connection or query error:', err);
    } finally {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    }
}

run();
    