const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    title : String , 
    priority : String ,
    status : String , 
    assignedTo : String , 
    createdAt : {type : Date , default : Date.now}

});
// Error fixed: mongoose.model() requires a model name and schema as separate arguments.
const Task = mongoose.model('Task', taskSchema);


async function addTasks(){
    try{
        const tasks =[
            {
                title : "Design login page UI",
                priority : "High",
                status: "Pending",
                assignedTo : "Danyal Khan"
            },

            {
                title : "Fix API response Bugs",
                priority: "Medium",
                status : "Pending",
                assignedTo : "Maheen jan"
            },

            {
                title : "Integrate payment gateway",
                priority : "High",
                status : "In-Progress",
                // Error fixed: the incomplete property `a` caused a syntax error.
                assignedTo: "Maheen jan"
            },
            {
                title: "Write unit tests for auth module",
                priority: "Medium",
                status: "In-Progress",
                assignedTo: "Danyal"

            },
            {
                title: "Deploy app to production",
                priority: "High",
                status: "Done",
                assignedTo: "Ali"

            },

        ];
        // Error fixed: this function must run only after MongoDB is connected.
        const result = await Task.insertMany(tasks);
        console.log('Task added successfully ' , result);
    }
    catch(error){
        console.error("Error adding tasks:", error.message);
    }

}


async function getPendingTasks(){
    try{
        // Error fixed: status values are case-sensitive; inserted tasks use "Pending".
        const pendingTasks = await Task.find({status : "Pending"});
        console.log("pending Task");
        console.log(pendingTasks);
    }
    catch(error){
        console.error("Error fetching pending tasks:", error.message);
    }
}

async function startTask(taskTitle){
    try{
        // Error fixed: findAndOneUpdate() does not exist; use findOneAndUpdate().
        const updatedTask = await Task.findOneAndUpdate(
            {title: taskTitle, status: "Pending" },
            {status : "In-Progress"},
            {new : true}
        );
        // Error fixed: `result` was undefined; the query result is `updatedTask`.
        if(!updatedTask){
            console.log("Task not found!");
        }
        else{
            console.log("Task updated successfully");
            console.log(updatedTask);
        }
    }
    catch(error){
        console.error("Error updating task:", error.message);
    }
}

async function completeTask(taskTitle){
    try{
        const updatedTask = await Task.findOneAndUpdate(
            // Error fixed: this task is inserted as In-Progress, not Pending.
            {title:taskTitle, status:"In-Progress" },
            {status : "Done"},
            {new : true}
        )
        // Error fixed: `result` was undefined; use the declared `updatedTask`.
        if(!updatedTask){
            console.log("Task not found");
        }
        else{
            console.log("Task updated successfully");
            console.log(updatedTask);
        }

    }
    catch(error){
        console.error("Error updating Task " , error.message);

    }
    
}

async function deleteCompletedTasks(){
    try{
        const deletedTask = await Task.deleteMany({status : "Done"});
        console.log("Completed tasks deleted!");
        // Error fixed: `result` was undefined; use the delete operation result.
        console.log(`Deleted count: ${deletedTask.deletedCount}`);
    }
    catch(error){
        console.error("Error deleting completed tasks:", error.message);
    }
}

async function getTasksByPerson(personName){
    try{
        // Error fixed: the result was stored in `findPerson` but later read as undefined `personTasks`.
        const personTasks = await Task.find({assignedTo: personName});
        if (personTasks.length === 0) {
      console.log(`No tasks found for ${personName}.`);
    } else {
      console.log(`Tasks assigned to ${personName}:`);
      console.log(personTasks);
    }
  } catch (error) {
    console.error("Error fetching tasks by person:", error.message);
  }
}


async function main() {
    // Error fixed: operations were started before database connection and task insertion completed.
    await mongoose.connect('mongodb://127.0.0.1:27017/taskManagerDB');
    console.log('Database connected successfully');
    // Error fixed: all database operations are awaited after the connection.
    // Error fixed: the old file started the same operations outside main() and again in run().
    await Task.deleteMany({}); // Prevent duplicate demo records on repeated runs.
    await addTasks();
    await getPendingTasks();
    await startTask("Design login page UI");
    await completeTask("Integrate payment gateway");
    await deleteCompletedTasks();
    await getTasksByPerson("Danyal");
}

// Error fixed: the individual functions are called only after the connection is ready.
main()
    .catch((error) => {
        if (error.code === 'ECONNREFUSED') {
            console.error(
                'MongoDB is not running at 127.0.0.1:27017. Start the MongoDB service, then run this script again.'
            );
        } else {
            console.error('Application error:', error.message);
        }
    })
    .finally(() => mongoose.disconnect());
        

    
   

