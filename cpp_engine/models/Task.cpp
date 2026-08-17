#include "Task.h"

Task::Task() : title_(""), description_(""), dueDate_(""), priority_("Medium"), completed_(false) {}

Task::Task(const std::string& title, const std::string& description,
           const std::string& dueDate, const std::string& priority)
    : title_(title), description_(description), dueDate_(dueDate), priority_(priority), completed_(false) {}

const std::string& Task::getTitle() const {
    return title_;
}

void Task::setTitle(const std::string& title) {
    title_ = title;
}

const std::string& Task::getDescription() const {
    return description_;
}

void Task::setDescription(const std::string& description) {
    description_ = description;
}

const std::string& Task::getDueDate() const {
    return dueDate_;
}

void Task::setDueDate(const std::string& dueDate) {
    dueDate_ = dueDate;
}

const std::string& Task::getPriority() const {
    return priority_;
}

void Task::setPriority(const std::string& priority) {
    priority_ = priority;
}

bool Task::isCompleted() const {
    return completed_;
}

void Task::setCompleted(bool completed) {
    completed_ = completed;
}
