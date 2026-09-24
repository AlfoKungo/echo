"""How a vocabulary gloss is said aloud on the Walkman track.

A gloss is written for reading: senses split by ';', grammar notes in parentheses
("before a masculine noun", "stressed pronoun", "man"). Spoken, most grammar notes are
noise and the senses become a short list. Two notes carry the difference between French
words that share an English gloss, so they are said: formal or informal (tu and vous,
s'il te plaît and s'il vous plaît), and who "they" and "them" are (ils and elles). A note
that narrows the meaning is kept too: one that reads on as a phrase joins without a
pause ("to know a fact", "in a city", "to spend time"); any other follows a comma
("fly, insect"). A sense that only repeats the number in digits ("one; 1") is not said twice.
A French noun said with its article is answered the same way, "le poisson" with "the fish":
the pair sounds natural, and a lone short word is what the voice and the checker get wrong.
"""
import re

GRAMMAR = re.compile(r'\b(noun|nouns|pronoun|subject|object|masculine|feminine|mixed|stressed|possessor|conjunction|'
                     r'preposition|plural|singular|formal|informal|standalone|before a verb|male|female|man|woman)\b', re.I)
RUNS_ON = re.compile(r'^(a|an|the|for|of|in|at|with|between|on|from|by|to|away|someone|something|time)\b', re.I)
MAX_SENSES = 3


def grammar_note(note):
    """The part of a grammar note worth saying aloud, or None."""
    if re.search(r'\bmasculine or mixed\b', note):
        return 'men or a mixed group'
    if re.search(r'\bfeminine group\b', note):
        return 'women only'
    register = re.search(r'\b(informal|formal)( or plural)?\b', note)
    return register.group(0) if register else None


def spoken(gloss, french=''):
    senses = []
    for sense in gloss.split(';'):
        notes = [note.strip() for note in re.findall(r'\(([^)]*)\)', sense)]
        text = re.sub(r'[!?…]+', '', re.sub(r'\s*\([^)]*\)', '', sense)).strip(' .,')
        for note in notes:
            if GRAMMAR.search(note):
                said = grammar_note(note)
                if said:
                    text = f'{text}, {said}'
                continue
            text = f'{text} {note}' if RUNS_ON.match(note) else f'{text}, {note}'
        if text and not text.isdigit() and text.lower() not in (s.lower() for s in senses):
            senses.append(text)
    if senses and re.match(r"^(le|la|les|l['’])\s*\w", french, re.I) and not re.match(r'^(the|a|an|to)\b', senses[0], re.I):
        senses[0] = f'the {senses[0]}'
    elif senses and re.match(r'^(un|une|des)\s', french, re.I) and not re.match(r'^(the|a|an|to)\b', senses[0], re.I):
        senses[0] = f'{"an" if re.match(r"[aeio]", senses[0], re.I) else "a"} {senses[0]}'
    return ', '.join(senses[:MAX_SENSES]) + '.'
