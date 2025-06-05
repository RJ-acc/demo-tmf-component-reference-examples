{{- define "tmf645-example.fullname" -}}
{{ .Release.Name }}-{{ .Chart.Name }}
{{- end -}}
