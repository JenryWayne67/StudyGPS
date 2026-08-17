#pragma once

#include <string>

class StudySession {
public:
    StudySession();
    StudySession(const std::string& sessionId, const std::string& title,
                 const std::string& date, const std::string& startTime,
                 const std::string& endTime, int durationMinutes,
                 const std::string& focusTopic);

    const std::string& getSessionId() const;
    void setSessionId(const std::string& sessionId);

    const std::string& getTitle() const;
    void setTitle(const std::string& title);

    const std::string& getDate() const;
    void setDate(const std::string& date);

    const std::string& getStartTime() const;
    void setStartTime(const std::string& startTime);

    const std::string& getEndTime() const;
    void setEndTime(const std::string& endTime);

    int getDurationMinutes() const;
    void setDurationMinutes(int durationMinutes);

    const std::string& getFocusTopic() const;
    void setFocusTopic(const std::string& focusTopic);

    bool isCompleted() const;
    void setCompleted(bool completed);

private:
    std::string sessionId_;
    std::string title_;
    std::string date_;
    std::string startTime_;
    std::string endTime_;
    int durationMinutes_;
    std::string focusTopic_;
    bool completed_;
};
