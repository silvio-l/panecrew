# PaneCrew shell integration — generated file, do not edit.
#
# zsh reads $ZDOTDIR/.zshenv before anything else. PaneCrew points ZDOTDIR at
# its own directory purely to get this file (and .zshrc) read; the user's own
# files are never touched, only sourced from here.

: ${PANECREW_USER_ZDOTDIR:=$HOME}

# The user's .zshenv must see its own ZDOTDIR, not PaneCrew's.
ZDOTDIR=$PANECREW_USER_ZDOTDIR
[[ -f $ZDOTDIR/.zshenv ]] && source "$ZDOTDIR/.zshenv"

# A user's .zshenv is the canonical place to set ZDOTDIR — if it did, that is
# the real one from here on.
PANECREW_USER_ZDOTDIR=${ZDOTDIR:-$HOME}

# Spawned with -l (shell_integration.rs) so PATH setup living in .zprofile —
# where Homebrew's and nvm's own installers put it, not .zshrc — takes effect
# here too, same as it already does in Terminal.app/iTerm2's own default
# login shell. Sourced explicitly, because zsh's own automatic .zprofile
# lookup happens as a separate step AFTER this file returns, by which point
# ZDOTDIR below has already been flipped to PaneCrew's own directory — zsh
# would silently find nothing there instead of the user's real file.
[[ -o login && -f $ZDOTDIR/.zprofile ]] && source "$ZDOTDIR/.zprofile"

# Back to PaneCrew's directory so zsh reads PaneCrew's .zshrc next.
ZDOTDIR=$PANECREW_ZDOTDIR
