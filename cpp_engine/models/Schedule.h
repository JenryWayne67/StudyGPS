#pragma once

#include <string>
#include <vector>

class Schedule {
public:
    Schedule();
    Schedule(const std::string& name, const std::string& weekStartDate);

    const std::string& getName() const;
    void setName(const std::string& name);

    const std::string& getWeekStartDate() const;
    void setWeekStartDate(const std::string& weekStartDate);

    const std::vector<std::string>& getSessionIds() const;
    void addSessionId(const std::string& sessionId);

private:
    std::string name_;
    std::string weekStartDate_;
    std::vector<std::string> sessionIds_;
};
