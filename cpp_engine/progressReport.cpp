// progressReport.cpp - study progress: completion, study time, schedule adherence, per course.
// stdin: TASK|name|course|status|planned|actual lines; stdout: REPORT and COURSE key=value lines.

#include <iostream>
#include <vector>
#include <string>
#include <iomanip>
#include <sstream>
#include <cmath>
#include <cstdlib>

using namespace std;


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


struct Task
{
    string name;
    string course;
    TaskStatus status;
    int plannedMinutes;
    int actualMinutes;
};


// Rounds to 1 decimal place (66.666 -> 66.7).
double roundTo1Decimal(double value)
{
    return round(value * 10.0) / 10.0;
}

// "80%" for whole numbers, "66.7%" otherwise.
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


struct CourseProgress
{
    string course;
    int totalTasks;
    int completedTasks;
    double percentage;
};


struct TaskProgress
{
    int notStarted;
    int inProgress;
    int completed;
};


class ProgressReport
{
private:

    vector<Task> tasks;


public:

    ProgressReport(const vector<Task>& taskList)
    {
        tasks = taskList;
    }


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


    int calculateTotalStudyTime() const
    {
        int totalMinutes = 0;

        for (const Task& task : tasks)
        {
            totalMinutes += task.actualMinutes;
        }

        return totalMinutes;
    }


    // Actual minutes as a percentage of planned minutes.
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


    // Completion per course, courses in first-seen order.
    vector<CourseProgress> calculateCourseProgress() const
    {
        vector<string> courses;

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


TaskStatus parseStatus(const string& s)
{
    if (s == "Completed") return TaskStatus::Completed;
    if (s == "In Progress") return TaskStatus::InProgress;
    return TaskStatus::NotStarted; // "Not Started" and anything unrecognized
}

vector<string> splitPipe(const string& line)
{
    vector<string> fields;
    stringstream ss(line);
    string field;
    while (getline(ss, field, '|'))
    {
        fields.push_back(field);
    }
    return fields;
}

// Reads TASK lines from stdin; prints the REPORT line and one COURSE line per course.
int main()
{
    vector<Task> tasks;

    string line;
    while (getline(cin, line))
    {
        if (line.empty()) continue;

        vector<string> fields = splitPipe(line);
        if (fields.size() < 6 || fields[0] != "TASK") continue;

        Task t;
        t.name = fields[1];
        t.course = fields[2];
        t.status = parseStatus(fields[3]);
        t.plannedMinutes = atoi(fields[4].c_str());
        t.actualMinutes = atoi(fields[5].c_str());

        tasks.push_back(t);
    }

    ProgressReport report(tasks);

    TaskProgress taskProgress = report.calculateTaskProgress();
    double completionRate = report.calculateCompletionRate();
    int totalStudyMinutes = report.calculateTotalStudyTime();
    double adherence = report.calculateScheduleAdherence();
    vector<CourseProgress> courseProgress = report.calculateCourseProgress();

    cout << "REPORT"
         << " tasks_completed=" << taskProgress.completed
         << " tasks_total=" << tasks.size()
         << " completion_rate=" << completionRate
         << " study_minutes=" << totalStudyMinutes
         << " schedule_adherence=" << adherence
         << "\n";

    for (const CourseProgress& cp : courseProgress)
    {
        cout << "COURSE"
             << " total=" << cp.totalTasks
             << " completed=" << cp.completedTasks
             << " percentage=" << cp.percentage
             << " name=" << cp.course
             << "\n";
    }

    return 0;
}
