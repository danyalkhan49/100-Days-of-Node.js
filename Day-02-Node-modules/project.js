let students = [
  { 
    id: 1, 
    name: "Ali", 
    walletBalance: 5000, 
    coursePrice: 3000,
    attendance: [1, 1, 0, 1, 1, 1, 0],  // 7 din ka data (1=present, 0=absent)
    marks: { assignment: 80, quiz: 70, project: 90 }
  },
  { 
    id: 2, 
    name: "Sara", 
    walletBalance: 2000, 
    coursePrice: 3000,
    attendance: [1, 1, 1, 1, 1, 1, 1],
    marks: { assignment: 45, quiz: 50, project: 40 }
  },
  { 
    id: 3, 
    name: "Hamza", 
    walletBalance: 10000, 
    coursePrice: 3000,
    attendance: [0, 0, 1, 0, 1, 0, 0],
    marks: { assignment: 88, quiz: 92, project: 85 }
  }
];

function buyCourse(studentId){
  // Error: parameter studentId was shadowed by a local declaration and id, walletBalance,
  // coursePrice, students.name were referenced incorrectly.
  let student = students.find(s => s.id === studentId);
  if(!student){
    console.log("Student Not Found");
    return;
  }

  if(student.walletBalance >= student.coursePrice){
    let remainingBalance = student.walletBalance - student.coursePrice;
    console.log(student.name + ": Course Purchased Successfully, Remaining Balance: " + remainingBalance);
  } else {
    console.log(student.name + ": Insufficient Balance, Please Add Funds");
  }
}

function checkAttendance(studentId){

  let student = students.find(s => s.id === studentId);
  if(!student){
    console.log("Student Not Found");
    return;
  }

  let presentDays = student.attendance.reduce((count, day) => count + day, 0);
  console.log(student.name + ": Present for " + presentDays + " days out of " + student.attendance.length + " days");
  let percentage = presentDays/7 *100 ;
  if(percentage >=75){
    console.log(`${student.name} has ${percentage}% Attendance - Eligible for Certificate`);
  }
  else{
    console.log(`${student.name} has ${percentage}% Attendance - NOt Eligible for Certificate`);

  }
}


function calculateGrade(studentId){
  let student = students.find(s => s.id === studentId);
  if(!student){
    console.log("Student not found");
    return;
  }
  let marks = student.marks;
  let average = (marks.assignment + marks.quiz + marks.project) / 3;
  console.log(student.name + ": Average Marks = " + average.toFixed(2));

  if(average >= 80){
    grade = "Grade A";
  } else if(average >= 60 && average < 80){
    grade = "Grade B";
  } else if(average >= 40 && average < 60){
    grade = "Grade C";
  } else {
    grade = "Fail";
  }
  console.log(student.name + " has average: " + average.toFixed(2) + "% and Grade is " + grade);
  return grade;
}


async function generateCertificate(studentId){
  let student = students.find(s => s.id === studentId);
  if(!student){
    console.log("Student Not Found");
    return;
  }

  // Check attendance
  let presentDays = student.attendance.reduce((count, day) => count + day, 0);
  let percentage = presentDays / 7 * 100;
  let attendanceEligible = percentage >= 75;

  // Check grade
  let marks = student.marks;
  let average = (marks.assignment + marks.quiz + marks.project) / 3;
  let grade;
  
  if(average >= 80){
    grade = "Grade A";
  } else if(average >= 60 && average < 80){
    grade = "Grade B";
  } else if(average >= 40 && average < 60){
    grade = "Grade C";
  } else {
    grade = "Fail";
  }

  // Check if eligible for certificate
  if(attendanceEligible && grade !== "Fail"){
    try {
      const message = await new Promise((resolve) => {
        setTimeout(() => {
          resolve(`Certificate Generated for ${student.name}! Grade: ${grade}`);
        }, 2000);
      });
      console.log(message);
    } catch(error) {
      console.log("Error generating certificate: " + error);
    }
  } else {
    console.log(`Certificate Not Issued for ${student.name} - Reason: Low Attendance/Grade`);
  }
}


async function processAllStudents() {
  for(let i = 0 ; i < students.length ; i++){
    console.log("\n========== Processing " + students[i].name + " ==========");
    buyCourse(students[i].id);
    checkAttendance(students[i].id);
    calculateGrade(students[i].id);
    await generateCertificate(students[i].id);
  }
}

processAllStudents();