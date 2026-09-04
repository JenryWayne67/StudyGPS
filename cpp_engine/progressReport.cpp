// progressReport.cpp
//
// Calculates a student's study progress based on
// tasks, planned/actual study time, and courses.
//
// Build:
// g++ -std=c++17 -O2 -o progressReport progressReport.cpp
//
// Run:
// ./progressReport
//

#include <iostream>
#include <vector>
#include <string>
#include <iomanip>
#include <sstream>
#include <cmath>

using namespace std;


// ---------------------------------------------------------
// TaskStatus
// ---------------------------------------------------------
//
// An enum instead of raw strings, so a typo like "Completd"
// fails to compile instead of silently being counted as
// nothing.

enum class TaskStatus
{
    NotStarted,
    InProgress,
    Completed
};

string taskStatusToString(TaskStatus status)
{
    switch (status)
    {
        case TaskStatus::NotStarted: return "Not Started";
        case TaskStatus::InProgress: return "In Progress";
        case TaskStatus::Completed:  return "Completed";
    }
    return "Unknown";
}


// ---------------------------------------------------------
// Task
// ---------------------------------------------------------

struct Task
{
    string name;
    string course;
    TaskStatus status;
    int plannedMinutes;
    int actualMinutes;
};


// ---------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------

// Rounds to 1 decimal place (e.g. 66.666.. -> 66.7).
double roundTo1Decimal(double value)
{
    return round(value * 10.0) / 10.0;
}

// Formats a percentage, dropping ".0" when the value is a
// whole number (80.0% -> "80%", 66.7% -> "66.7%").
string formatPercentage(double value)
{
    double rounded = roundTo1Decimal(value);

    ostringstream out;

    if (rounded == static_cast<int>(rounded))
    {
        out << static_cast<int>(rounded) << "%";
    }
    else
    {
        out << fixed << setprecision(1) << rounded << "%";
    }

    return out.str();
}


// ---------------------------------------------------------
// CourseProgress
// ---------------------------------------------------------
//
// Return type for calculateCourseProgress(), so the result
// can be reused (printed, exported, tested) instead of being
// tied to cout.

struct CourseProgress
{
    string course;
    int totalTasks;
    int completedTasks;
    double percentage;
};


// ---------------------------------------------------------
// TaskProgress
// ---------------------------------------------------------
//
// Return type for calculateTaskProgress(), replacing the
// out-parameter version.

struct TaskProgress
{
    int notStarted;
    int inProgress;
    int completed;
};


// ---------------------------------------------------------
// ProgressReport Class
// ---------------------------------------------------------

class ProgressReport
{
private:

    vector<Task> tasks;


public:

    // Constructor
    ProgressReport(const vector<Task>& taskList)
    {
        tasks = taskList;
    }


    // -----------------------------------------------------
    // 1. Calculate Completion Rate
    // -----------------------------------------------------

    double calculateCompletionRate() const
    {
        if (tasks.empty())
        {
            return 0.0;
        }

        int completedTasks = 0;

        for (const Task& task : tasks)
        {
            if (task.status == TaskStatus::Completed)
            {
                completedTasks++;
            }
        }

        return roundTo1Decimal(
            (static_cast<double>(completedTasks) / tasks.size()) * 100.0);
    }


    // -----------------------------------------------------
    // 2. Calculate Total Study Time
    // -----------------------------------------------------

    int calculateTotalStudyTime() const
    {
        int totalMinutes = 0;

        for (const Task& task : tasks)
        {
            totalMinutes += task.actualMinutes;
        }

        return totalMinutes;
    }


    // -----------------------------------------------------
    // 3. Calculate Schedule Adherence
    // -----------------------------------------------------

    double calculateScheduleAdherence() const
    {
        int plannedTime = 0;
        int actualTime = 0;

        for (const Task& task : tasks)
        {
            plannedTime += task.plannedMinutes;
            actualTime += task.actualMinutes;
        }

        if (plannedTime == 0)
        {
            return 0.0;
        }

        return roundTo1Decimal(
            (static_cast<double>(actualTime) / plannedTime) * 100.0);
    }


    // -----------------------------------------------------
    // 4. Calculate Task Progress
    // -----------------------------------------------------

    TaskProgress calculateTaskProgress() const
    {
        TaskProgress progress{0, 0, 0};

        for (const Task& task : tasks)
        {
            if (task.status == TaskStatus::NotStarted)
            {
                progress.notStarted++;
            }
            else if (task.status == TaskStatus::InProgress)
            {
                progress.inProgress++;
            }
            else if (task.status == TaskStatus::Completed)
            {
                progress.completed++;
            }
        }

        return progress;
    }


    // -----------------------------------------------------
    // 5. Calculate Course Progress
    // -----------------------------------------------------
    //
    // Returns the data instead of printing it, so the caller
    // decides how (or whether) to display it.

    vector<CourseProgress> calculateCourseProgress() const
    {
        vector<string> courses;

        // Find unique courses, in first-seen order.
        for (const Task& task : tasks)
        {
            bool exists = false;

            for (const string& course : courses)
            {
                if (course == task.course)
                {
                    exists = true;
                    break;
                }
            }

            if (!exists)
            {
                courses.push_back(task.course);
            }
        }


        // Calculate progress for each course.
        vector<CourseProgress> results;

        for (const string& course : courses)
        {
            int totalTasks = 0;
            int completedTasks = 0;

            for (const Task& task : tasks)
            {
                if (task.course == course)
                {
                    totalTasks++;

                    if (task.status == TaskStatus::Completed)
                    {
                        completedTasks++;
                    }
                }
            }

            double percentage = 0.0;

            if (totalTasks > 0)
            {
                percentage = roundTo1Decimal(
                    (static_cast<double>(completedTasks) / totalTasks) * 100.0);
            }

            results.push_back(CourseProgress{
                course, totalTasks, completedTasks, percentage});
        }

        return results;
    }


    // -----------------------------------------------------
    // 6. Generate Complete Report
    // -----------------------------------------------------

    void generateReport() const
    {
        TaskProgress taskProgress = calculateTaskProgress();

        double completionRate = calculateCompletionRate();

        int totalStudyMinutes = calculateTotalStudyTime();

        double adherence = calculateScheduleAdherence();

        vector<CourseProgress> courseProgress = calculateCourseProgress();


        int hours = totalStudyMinutes / 60;
        int minutes = totalStudyMinutes % 60;


        cout << "\n";
        cout << "==============================" << endl;
        cout << "       WEEKLY PROGRESS" << endl;
        cout << "==============================" << endl;

        cout << "\nTasks:" << endl;
        cout << taskProgress.completed << " / " << tasks.size() << endl;

        cout << "\nCompletion:" << endl;
        cout << formatPercentage(completionRate) << endl;

        cout << "\nTask Progress:" << endl;
        cout << "Not Started: " << taskProgress.notStarted << endl;
        cout << "In Progress: " << taskProgress.inProgress << endl;
        cout << "Completed: " << taskProgress.completed << endl;

        cout << "\nStudy Time:" << endl;
        cout << hours << " hours "
             << minutes << " minutes" << endl;

        cout << "\nSchedule Adherence:" << endl;
        cout << formatPercentage(adherence) << endl;

        cout << "\nCourse Progress:" << endl;
        for (const CourseProgress& cp : courseProgress)
        {
            cout << cp.course << ": " << formatPercentage(cp.percentage) << endl;
        }

        cout << "\n==============================" << endl;
    }
};


// ---------------------------------------------------------
// Main
// ---------------------------------------------------------

int main()
{
    // Sample data
    vector<Task> tasks =
    {
        {"Sets Homework", "Discrete Mathematics",
         TaskStatus::Completed, 60, 50},

        {"Functions Exercises", "Discrete Mathematics",
         TaskStatus::Completed, 60, 55},

        {"Matrices Practice", "Discrete Mathematics",
         TaskStatus::Completed, 60, 45},

        {"Sequences Assignment", "Discrete Mathematics",
         TaskStatus::Completed, 90, 70},

        {"Cardinality Quiz", "Discrete Mathematics",
         TaskStatus::Completed, 45, 40},

        {"Set Operations", "Discrete Mathematics",
         TaskStatus::Completed, 60, 50},

        {"Graph Theory", "Discrete Mathematics",
         TaskStatus::Completed, 90, 80},

        {"Logic Exercises", "Discrete Mathematics",
         TaskStatus::Completed, 60, 45},

        {"C++ Classes", "C++",
         TaskStatus::Completed, 60, 50},

        {"File I/O", "C++",
         TaskStatus::Completed, 60, 45},

        {"Pointers", "C++",
         TaskStatus::Completed, 90, 60},

        {"Inheritance", "C++",
         TaskStatus::Completed, 60, 50},

        {"Polymorphism", "C++",
         TaskStatus::InProgress, 60, 35},

        {"Templates", "C++",
         TaskStatus::InProgress, 60, 30},

        {"IP Addressing", "Networking",
         TaskStatus::Completed, 60, 40},

        {"VLANs", "Networking",
         TaskStatus::InProgress, 60, 35},

        {"Routing", "Networking",
         TaskStatus::NotStarted, 90, 0},

        {"Subnetting", "Networking",
         TaskStatus::NotStarted, 90, 0}
    };


    ProgressReport report(tasks);

    report.generateReport();


    return 0;
}
