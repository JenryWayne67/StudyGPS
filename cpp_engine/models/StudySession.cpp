#include "StudySession.h"

StudySession::StudySession()
    : sessionId_(""), title_(""), date_(""), startTime_(""), endTime_(""),
      durationMinutes_(0), focusTopic_(""), completed_(false) {}

StudySession::StudySession(const std::string& sessionId, const std::string& title,
                           const std::string& date, const std::string& startTime,
                           const std::string& endTime, int durationMinutes,
                           const std::string& focusTopic)
    : sessionId_(sessionId), title_(title), date_(date), startTime_(startTime), endTime_(endTime),
      durationMinutes_(durationMinutes), focusTopic_(focusTopic), completed_(false) {}

const std::string& StudySession::getSessionId() const {
    return sessionId_;
}

void StudySession::setSessionId(const std::string& sessionId) {
    sessionId_ = sessionId;
}

const std::string& StudySession::getTitle() const {
    return title_;
}

void StudySession::setTitle(const std::string& title) {
    title_ = title;
}

const std::string& StudySession::getDate() const {
    return date_;
}

void StudySession::setDate(const std::string& date) {
    date_ = date;
}

const std::string& StudySession::getStartTime() const {
    return startTime_;
}

void StudySession::setStartTime(const std::string& startTime) {
    startTime_ = startTime;
}

const std::string& StudySession::getEndTime() const {
    return endTime_;
}

void StudySession::setEndTime(const std::string& endTime) {
    endTime_ = endTime;
}

int StudySession::getDurationMinutes() const {
    return durationMinutes_;
}

void StudySession::setDurationMinutes(int durationMinutes) {
    durationMinutes_ = durationMinutes;
}

const std::string& StudySession::getFocusTopic() const {
    return focusTopic_;
}

void StudySession::setFocusTopic(const std::string& focusTopic) {
    focusTopic_ = focusTopic;
}

bool StudySession::isCompleted() const {
    return completed_;
}

void StudySession::setCompleted(bool completed) {
    completed_ = completed;
}
