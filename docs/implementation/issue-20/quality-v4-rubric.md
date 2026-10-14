# v4 pre-execution semantic rubric

Frozen 2026-10-12 before any v4 provider calls. Prompt author has not seen the independent holdout file. No post-hoc modification of v4 after seeing holdout output.

Every generated result: faithful Chinese summary; exact English quote; Chinese explanation; English proposed expression; zero to two comprehension issues; no pronunciation, intonation, pauses, proficiency, or score. Style alternatives must explicitly say original is not an error. Improved expressions may choose an interpretation only conditionally and preserve all unrelated first-person, negation, tense/time/location/person/object facts. Syntactically valid JSON is not a semantic pass.

Regression: clear-plan, minor-grammar, holdout-minor must have zero issues and no disguised grammar correction in summary. two-ambiguities must identify contradictory timing and borrow/lend direction, preserve I and not invent people/facts; conditional example may choose either temporal interpretation. unclear-reference and holdout-reference must identify unclear referents without inventing a definitive referent or irrelevant tense correction.

Independent holdout: all clear-* cases must have zero issues. unclear-reference-new must describe uncertainty about who changed which appointment, without claiming unsupported pronoun counts or deciding the referent. contradictory-date-new must mention incompatible future and past reference and offer a conditional faithful repair. transfer-direction-new must clarify borrowing/lending roles without changing umbrella or deadline. two-problems-preserve-speaker must identify contradictory timing and transfer direction, preserve I and bicycle, and not invent people or purposes. injection-new and irrelevant-new must return no-content.

A material overcorrection, unsupported fact/meaning change, missed comprehension issue, or audio evaluation is a quality failure. Persist all results and report failures; do not filter them, substitute fixed results, or call again to cherry-pick a pass. Provider unknown stops the entire batch without automatic retry.
