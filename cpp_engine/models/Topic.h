#pragma once

#include <string>

class Topic {
public:
    Topic();
    Topic(const std::string& title, const std::string& description,
          const std::string& difficulty, const std::string& learningObjective);

    const std::string& getTitle() const;
    void setTitle(const std::string& title);

    const std::string& getDescription() const;
    void setDescription(const std::string& description);

    const std::string& getDifficulty() const;
    void setDifficulty(const std::string& difficulty);

    const std::string& getLearningObjective() const;
    void setLearningObjective(const std::string& learningObjective);

private:
    std::string title_;
    std::string description_;
    std::string difficulty_;
    std::string learningObjective_;
};
