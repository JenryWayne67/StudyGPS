#include "Topic.h"

Topic::Topic() : title_(""), description_(""), difficulty_(""), learningObjective_("") {}

Topic::Topic(const std::string& title, const std::string& description,
             const std::string& difficulty, const std::string& learningObjective)
    : title_(title), description_(description), difficulty_(difficulty), learningObjective_(learningObjective) {}

const std::string& Topic::getTitle() const {
    return title_;
}

void Topic::setTitle(const std::string& title) {
    title_ = title;
}

const std::string& Topic::getDescription() const {
    return description_;
}

void Topic::setDescription(const std::string& description) {
    description_ = description;
}

const std::string& Topic::getDifficulty() const {
    return difficulty_;
}

void Topic::setDifficulty(const std::string& difficulty) {
    difficulty_ = difficulty;
}

const std::string& Topic::getLearningObjective() const {
    return learningObjective_;
}

void Topic::setLearningObjective(const std::string& learningObjective) {
    learningObjective_ = learningObjective;
}
