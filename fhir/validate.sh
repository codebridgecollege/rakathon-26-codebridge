#!/bin/sh
# Validates a FHIR export against FHIR R4 (4.0.1) with the official HL7 validator, loading our own extensions and
# code systems from fhir/definitions and the Czech core guide (hl7.fhir.cz.core 1.0.0). Needs Java 17+ and the
# validator jar, version 7.0.2:
#   https://github.com/hapifhir/org.hl7.fhir.core/releases/download/7.0.2/validator_cli.jar
# Usage: VALIDATOR_JAR=<path> [JAVA=<java>] sh fhir/validate.sh [bundle.json] > report.txt
# Local paths in the output are replaced, so the report can be committed.
set -e
BUNDLE=${1:-fhir/examples/case-10-bundle.json}
JAVA=${JAVA:-java}
"$JAVA" -jar "$VALIDATOR_JAR" "$BUNDLE" -version 4.0.1 -ig fhir/definitions -ig hl7.fhir.cz.core#1.0.0 -tx n/a -output-style compact 2>&1 \
  | sed -e "s|$PWD|.|g" -e "s|$HOME|~|g" -e "s|/var/folders/[^ ]*|<tmp>|g" -e "s|/opt/homebrew/[^ ]*|<java>|g"
