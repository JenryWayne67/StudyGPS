#pragma once

#include <string>

class Task {
public:
    Task();
    Task(const std::string& title, const std::string& description,
         const std::string& dueDate, const std::string& priority);

    const std::string& getTitle() const;
    void setTitle(const std::string& title);

    const std::string& getDescription() const;
    void setDescription(const std::string& description);

    const std::string& getDueDate() const;
    void setDueDate(const std::string& dueDate);

    const std::string& getPriority() const;
    void setPriority(const std::string& priority);

    bool isCompleted() const;
    void setCompleted(bool completed);

private:
    std::string title_;
    std::string description_;
    std::string dueDate_;
    std::string priority_;
    bool completed_;
};
